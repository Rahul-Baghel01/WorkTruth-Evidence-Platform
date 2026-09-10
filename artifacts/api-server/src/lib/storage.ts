import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

// ---------------------------------------------------------------------------
// A small storage abstraction, deliberately narrow, so a real object-storage
// backend (S3-compatible) can be swapped in later without touching callers —
// they only ever see `storageKey` (an opaque string) and this interface.
// Cloud storage is not introduced here: local filesystem is the only
// implementation, matching "do not introduce cloud storage unless genuinely
// required" for the local-first MVP.
// ---------------------------------------------------------------------------

export interface EvidenceStorage {
  /** Persists `buffer` for `projectId` and returns the opaque key to store in the DB. */
  save(projectId: string, buffer: Buffer, extension: string): Promise<string>;
  read(storageKey: string): Promise<Buffer>;
  delete(storageKey: string): Promise<void>;
}

// Only characters safe to use verbatim in a filesystem path segment. Project
// IDs come from validated DB rows, but this is enforced defensively anyway —
// an upload is refused rather than ever trusting a value into a path.
const SAFE_SEGMENT = /^[A-Za-z0-9_-]+$/;

function assertSafeSegment(value: string, label: string): void {
  if (!SAFE_SEGMENT.test(value)) {
    throw new Error(`Unsafe ${label} for storage path: ${JSON.stringify(value)}`);
  }
}

export class LocalFilesystemStorage implements EvidenceStorage {
  constructor(private readonly rootDir: string) {}

  private resolveProjectDir(projectId: string): string {
    assertSafeSegment(projectId, "project id");
    return path.join(this.rootDir, "projects", projectId);
  }

  private resolvePath(storageKey: string): string {
    // storageKey is always something *we* generated (projectId/uuid.ext) —
    // still reject anything that could escape rootDir if it were ever
    // tampered with (e.g. a stray ".." segment).
    const resolved = path.resolve(this.rootDir, storageKey);
    if (!resolved.startsWith(path.resolve(this.rootDir) + path.sep)) {
      throw new Error(`Storage key resolves outside the storage root: ${JSON.stringify(storageKey)}`);
    }
    return resolved;
  }

  async save(projectId: string, buffer: Buffer, extension: string): Promise<string> {
    if (!/^[a-z0-9]{2,5}$/.test(extension)) {
      throw new Error(`Unsafe file extension for storage: ${JSON.stringify(extension)}`);
    }
    const dir = this.resolveProjectDir(projectId);
    await mkdir(dir, { recursive: true });
    // Server-generated filename only — the client-supplied original filename
    // is never used as (or derived into) a path.
    const filename = `${randomUUID()}.${extension}`;
    const storageKey = path.posix.join("projects", projectId, filename);
    await writeFile(path.join(dir, filename), buffer);
    return storageKey;
  }

  async read(storageKey: string): Promise<Buffer> {
    return readFile(this.resolvePath(storageKey));
  }

  async delete(storageKey: string): Promise<void> {
    await rm(this.resolvePath(storageKey), { force: true });
  }
}

const UPLOAD_ROOT = process.env.EVIDENCE_UPLOAD_DIR
  ? path.resolve(process.env.EVIDENCE_UPLOAD_DIR)
  : path.resolve(process.cwd(), "uploads");

export const evidenceStorage: EvidenceStorage = new LocalFilesystemStorage(UPLOAD_ROOT);
