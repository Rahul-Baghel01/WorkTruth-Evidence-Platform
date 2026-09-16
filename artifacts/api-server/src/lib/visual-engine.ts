import { eq, ne } from "drizzle-orm";
import { db, evidenceImagesTable, projectsTable, type ProjectRow } from "@workspace/db";
import { hammingDistance } from "./image-processing";

// ---------------------------------------------------------------------------
// What this engine actually does
// ---------------------------------------------------------------------------
// No object/content recognition exists — there is no capability here to say
// what an image *shows*, let alone estimate construction progress from it.
// What genuinely is computed: exact-duplicate detection (SHA-256), visual
// near-duplicate detection (perceptual-hash Hamming distance — see
// image-processing.ts for the algorithm), and capture-date chronology. That
// is the real, honest scope of "visual intelligence" this phase delivers.

export const VISUAL_ENGINE_VERSION = "visual-v1";

export type VisualCheckSeverity = "INFO" | "LOW" | "MODERATE" | "HIGH";

export type VisualCheck = {
  name: string;
  severity: VisualCheckSeverity;
  message: string;
  observed?: Record<string, number>;
  supportingImageIds?: number[];
};

export type VisualStatus = "INSUFFICIENT_EVIDENCE" | "CONSISTENT" | "REQUIRES_VERIFICATION";

// The strongest visual finding this engine can make: a photograph submitted
// for THIS project is the same photograph (or a perceptual near-duplicate of
// one) already submitted for a DIFFERENT project. Every number here is
// measured from the two stored hashes — `similarityPercent` is simply the
// share of perceptual-hash bits that agree, not a model's confidence and not
// a claim about what either photograph depicts.
export type CrossProjectVisualMatch = {
  currentImageId: number;
  matchedProjectId: string;
  matchedProjectName: string | null;
  matchedImageId: number;
  /** Differing bits between the two perceptual hashes. */
  hammingDistance: number;
  /** Total bits compared — the hash length, so the percentage is checkable. */
  hashBits: number;
  /** (hashBits - hammingDistance) / hashBits, as a percentage. */
  similarityPercent: number;
  /** True when the two files are also byte-for-byte identical (same SHA-256). */
  isExactDuplicate: boolean;
};

export type VisualAnalysisResult = {
  status: VisualStatus;
  score: number | null;
  confidence: number;
  imageCount: number;
  datedImageCount: number;
  undatedImageCount: number;
  earliestCapturedAt: string | null;
  latestCapturedAt: string | null;
  checks: VisualCheck[];
  reasons: string[];
  /** Best cross-project match found, or null when none is within threshold. */
  crossProjectMatch: CrossProjectVisualMatch | null;
  engineVersion: string;
  updatedAt: string;
};

export type RawVisualImage = {
  id: number;
  sha256: string | null;
  perceptualHash: string | null;
  capturedAt: Date | string | null;
};

/** An evidence image belonging to some OTHER project, for reuse detection. */
export type PeerVisualImage = RawVisualImage & {
  projectId: string;
  projectName: string | null;
};

// ---------------------------------------------------------------------------
// Tunable constants — documented so the score is reproducible and explainable
// ---------------------------------------------------------------------------

const SEVERITY_WEIGHT: Record<VisualCheckSeverity, number> = { INFO: 0, LOW: 0.1, MODERATE: 0.25, HIGH: 0.5 };
const ANOMALY_SCORE_THRESHOLD = 0.35;

// The pHash here is 64 bits. A Hamming distance of 0 is byte-for-byte
// identical content re-encoded; published guidance for this algorithm
// (hackerfactor.com) treats up to ~10 bits of a 64-bit hash as "very
// similar." We use 8 (12.5%) as a deliberately conservative bar — a
// configurable heuristic, not a statistically derived threshold.
const NEAR_DUPLICATE_HAMMING_THRESHOLD = 8;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function pairKey(a: number, b: number): string {
  return a < b ? `${a}:${b}` : `${b}:${a}`;
}

function pairsOf<T extends { id: number }>(group: T[]): Array<[T, T]> {
  const pairs: Array<[T, T]> = [];
  for (let i = 0; i < group.length; i++) {
    for (let j = i + 1; j < group.length; j++) pairs.push([group[i], group[j]]);
  }
  return pairs;
}

function toDate(value: Date | string | null): Date | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

// ---------------------------------------------------------------------------
// Pure evaluation — no I/O, fully unit-testable with synthetic fixtures
// ---------------------------------------------------------------------------

export function evaluateVisualEvidence(images: RawVisualImage[], peerImages: PeerVisualImage[] = []): VisualAnalysisResult {
  const now = new Date().toISOString();
  const checks: VisualCheck[] = [];
  const reasons: string[] = [];

  if (!images.length) {
    return {
      status: "INSUFFICIENT_EVIDENCE",
      score: null,
      confidence: 0,
      imageCount: 0,
      datedImageCount: 0,
      undatedImageCount: 0,
      earliestCapturedAt: null,
      latestCapturedAt: null,
      checks: [],
      reasons: ["No evidence images are available for this project."],
      crossProjectMatch: null,
      engineVersion: VISUAL_ENGINE_VERSION,
      updatedAt: now,
    };
  }

  reasons.push(`${images.length} evidence image${images.length === 1 ? " was" : "s were"} uploaded.`);

  // --- chronology (capturedAt only — never uploadedAt) ---
  const dated = images
    .map((img) => ({ id: img.id, date: toDate(img.capturedAt) }))
    .filter((img): img is { id: number; date: Date } => img.date !== null)
    .sort((a, b) => a.date.getTime() - b.date.getTime());
  const undatedCount = images.length - dated.length;
  const earliestCapturedAt = dated.length ? dated[0].date.toISOString() : null;
  const latestCapturedAt = dated.length ? dated[dated.length - 1].date.toISOString() : null;

  if (dated.length) {
    reasons.push(`${dated.length} image${dated.length === 1 ? " contains" : "s contain"} valid capture timestamps.`);
    if (dated.length >= 2) {
      const spanDays = Math.round((dated[dated.length - 1].date.getTime() - dated[0].date.getTime()) / 86_400_000);
      reasons.push(`The latest image is ${spanDays} day${spanDays === 1 ? "" : "s"} after the earliest image.`);
    }
  } else {
    checks.push({ name: "no_capture_metadata", severity: "INFO", message: "No capture metadata was available for any evidence image." });
    reasons.push("No capture metadata was available.");
  }

  if (images.length === 1) {
    checks.push({ name: "single_image_limited_evidence", severity: "INFO", message: "No visual progression assessment was possible because only one image exists." });
    reasons.push("No visual progression assessment was possible because only one image exists.");
  }

  // --- exact duplicates: SHA-256 ---
  const bySha = new Map<string, RawVisualImage[]>();
  for (const img of images) {
    if (!img.sha256) continue;
    const list = bySha.get(img.sha256) ?? [];
    list.push(img);
    bySha.set(img.sha256, list);
  }
  const exactDuplicateGroups = [...bySha.values()].filter((g) => g.length > 1);
  for (const group of exactDuplicateGroups) {
    checks.push({
      name: "exact_duplicate_files",
      severity: "HIGH",
      message: `${group.length} evidence images are byte-for-byte identical files (same SHA-256 hash).`,
      supportingImageIds: group.map((i) => i.id),
    });
  }
  const exactDuplicatePairKeys = new Set(exactDuplicateGroups.flatMap((g) => pairsOf(g).map(([a, b]) => pairKey(a.id, b.id))));

  // --- near-duplicates: perceptual hash, excluding pairs already caught as exact duplicates ---
  const withHash = images.filter((img): img is RawVisualImage & { perceptualHash: string } => Boolean(img.perceptualHash));
  const nearDuplicatePairs: Array<{ a: RawVisualImage; b: RawVisualImage; distance: number }> = [];
  for (let i = 0; i < withHash.length; i++) {
    for (let j = i + 1; j < withHash.length; j++) {
      const a = withHash[i];
      const b = withHash[j];
      if (exactDuplicatePairKeys.has(pairKey(a.id, b.id))) continue;
      const distance = hammingDistance(a.perceptualHash, b.perceptualHash);
      if (distance <= NEAR_DUPLICATE_HAMMING_THRESHOLD) nearDuplicatePairs.push({ a, b, distance });
    }
  }
  if (nearDuplicatePairs.length) {
    const involvedIds = [...new Set(nearDuplicatePairs.flatMap((p) => [p.a.id, p.b.id]))];
    checks.push({
      name: "near_duplicate_images",
      severity: "MODERATE",
      message: `${involvedIds.length} images have near-identical perceptual hashes (Hamming distance ≤ ${NEAR_DUPLICATE_HAMMING_THRESHOLD} of 64 bits).`,
      observed: { pairCount: nearDuplicatePairs.length, minDistance: Math.min(...nearDuplicatePairs.map((p) => p.distance)) },
      supportingImageIds: involvedIds,
    });
    reasons.push(`${involvedIds.length} images have near-identical perceptual hashes.`);
  }

  // --- lack of visual change across dated evidence (progress-image signal) ---
  const datedById = new Map(dated.map((d) => [d.id, d.date]));
  const allDuplicatePairs: Array<[RawVisualImage, RawVisualImage]> = [
    ...exactDuplicateGroups.flatMap((g) => pairsOf(g)),
    ...nearDuplicatePairs.map((p): [RawVisualImage, RawVisualImage] => [p.a, p.b]),
  ];
  const differentDatePairs = allDuplicatePairs.filter(([a, b]) => {
    const dateA = datedById.get(a.id);
    const dateB = datedById.get(b.id);
    return dateA && dateB && dateA.getTime() !== dateB.getTime();
  });
  if (differentDatePairs.length) {
    const involvedIds = [...new Set(differentDatePairs.flatMap(([a, b]) => [a.id, b.id]))];
    checks.push({
      name: "no_visual_change_across_dates",
      severity: "MODERATE",
      message: `${differentDatePairs.length} pair${differentDatePairs.length === 1 ? "" : "s"} of near-identical or identical images were captured on different dates — no visible change between dated evidence.`,
      supportingImageIds: involvedIds,
    });
    reasons.push("Evidence images captured on different dates show no visible change between them.");
  }

  // --- evidence reused from another project (perceptual hash, cross-project) ---
  // Same primitives as the within-project check above, but compared against
  // OTHER projects' images. Rated HIGH rather than MODERATE: two similar
  // photographs inside one project are expected (one site, photographed
  // twice), whereas the same photograph appearing under two different
  // projects means one of those claims is not evidenced by its own record.
  let crossProjectMatch: CrossProjectVisualMatch | null = null;
  for (const image of images) {
    if (!image.perceptualHash) continue;
    for (const peer of peerImages) {
      if (!peer.perceptualHash) continue;
      const distance = hammingDistance(image.perceptualHash, peer.perceptualHash);
      if (distance > NEAR_DUPLICATE_HAMMING_THRESHOLD) continue;
      const hashBits = image.perceptualHash.length;
      const candidate: CrossProjectVisualMatch = {
        currentImageId: image.id,
        matchedProjectId: peer.projectId,
        matchedProjectName: peer.projectName,
        matchedImageId: peer.id,
        hammingDistance: distance,
        hashBits,
        similarityPercent: Math.round(((hashBits - distance) / hashBits) * 1000) / 10,
        isExactDuplicate: Boolean(image.sha256 && peer.sha256 && image.sha256 === peer.sha256),
      };
      // Keep the closest match; prefer an exact duplicate at equal distance.
      if (
        !crossProjectMatch ||
        distance < crossProjectMatch.hammingDistance ||
        (distance === crossProjectMatch.hammingDistance && candidate.isExactDuplicate && !crossProjectMatch.isExactDuplicate)
      ) {
        crossProjectMatch = candidate;
      }
    }
  }
  if (crossProjectMatch) {
    const { matchedProjectId, similarityPercent, hammingDistance: distance, hashBits, isExactDuplicate } = crossProjectMatch;
    checks.push({
      name: "cross_project_duplicate_evidence",
      severity: "HIGH",
      message: isExactDuplicate
        ? `An evidence photograph is byte-for-byte identical (same SHA-256) to one submitted for project ${matchedProjectId}.`
        : `Perceptual-hash similarity indicates an evidence photograph is a near-duplicate of one submitted for project ${matchedProjectId} (${similarityPercent}% of ${hashBits} hash bits match; Hamming distance ${distance}).`,
      observed: { similarityPercent, hammingDistance: distance, hashBits },
      supportingImageIds: [crossProjectMatch.currentImageId],
    });
    reasons.push(
      isExactDuplicate
        ? `An evidence photograph is identical to one already submitted for project ${matchedProjectId}.`
        : `An evidence photograph is a perceptual near-duplicate of one submitted for project ${matchedProjectId} (${similarityPercent}% hash similarity).`,
    );
  }

  // --- score, status, confidence ---
  const triggered = checks.filter((c) => c.severity !== "INFO");
  const score = clamp(triggered.reduce((sum, c) => sum + SEVERITY_WEIGHT[c.severity], 0), 0, 1);
  const status: VisualStatus = score < ANOMALY_SCORE_THRESHOLD ? "CONSISTENT" : "REQUIRES_VERIFICATION";

  // Confidence rises with image count (capped) and with the presence of any
  // dated evidence — independent of whether duplicates were found.
  let confidence = 0.25 + Math.min(images.length, 5) * 0.1;
  if (dated.length > 0) confidence += 0.1;
  confidence = clamp(confidence, 0.1, 0.95);

  if (triggered.length) {
    for (const c of triggered) if (!reasons.includes(c.message)) reasons.push(c.message);
  } else {
    reasons.push("No visual anomalies were detected in the available evidence.");
  }

  return {
    status,
    score,
    confidence,
    imageCount: images.length,
    datedImageCount: dated.length,
    undatedImageCount: undatedCount,
    earliestCapturedAt,
    latestCapturedAt,
    checks,
    reasons,
    crossProjectMatch,
    engineVersion: VISUAL_ENGINE_VERSION,
    updatedAt: now,
  };
}

// ---------------------------------------------------------------------------
// I/O wrapper
// ---------------------------------------------------------------------------

export async function computeVisualAnalysis(project: ProjectRow): Promise<VisualAnalysisResult> {
  const rows = await db.select().from(evidenceImagesTable).where(eq(evidenceImagesTable.projectId, project.id));
  const images: RawVisualImage[] = rows.map((r) => ({ id: r.id, sha256: r.sha256, perceptualHash: r.perceptualHash, capturedAt: r.capturedAt }));

  // Every other project's hashed evidence, for reuse detection. Only the hash
  // columns are read — never the image bytes — so this stays a cheap index
  // scan. It is a full pairwise comparison against the portfolio, which is
  // fine at this scale; a much larger corpus would want a hash index (e.g.
  // BK-tree) rather than this linear scan.
  const peerRows = await db
    .select({
      id: evidenceImagesTable.id,
      projectId: evidenceImagesTable.projectId,
      projectName: projectsTable.name,
      sha256: evidenceImagesTable.sha256,
      perceptualHash: evidenceImagesTable.perceptualHash,
      capturedAt: evidenceImagesTable.capturedAt,
    })
    .from(evidenceImagesTable)
    .innerJoin(projectsTable, eq(projectsTable.id, evidenceImagesTable.projectId))
    .where(ne(evidenceImagesTable.projectId, project.id));

  return evaluateVisualEvidence(images, peerRows);
}
