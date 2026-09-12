import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { eq } from "drizzle-orm";
import { db, sessionsTable, usersTable } from "@workspace/db";

const scryptAsync = promisify(scrypt);
const SCRYPT_KEYLEN = 64;

// The single place email is canonicalised, so the value written by the seed
// and the value looked up at login can never disagree over surrounding
// whitespace or letter case (a mismatch there otherwise reads to the user as
// a wrong password — a silent, confusing 401). Login identifiers are treated
// case-insensitively; the address is still displayed with whatever case the
// row was created with.
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const derivedKey = (await scryptAsync(password, salt, SCRYPT_KEYLEN)) as Buffer;
  return `${salt}:${derivedKey.toString("hex")}`;
}

export async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  const [salt, key] = storedHash.split(":");
  if (!salt || !key) return false;
  const keyBuffer = Buffer.from(key, "hex");
  const derivedKey = (await scryptAsync(password, salt, keyBuffer.length)) as Buffer;
  if (derivedKey.length !== keyBuffer.length) return false;
  return timingSafeEqual(derivedKey, keyBuffer);
}

// Decides what a re-runnable seed must do to bring the seed officer's
// password into line with the configured SEED_OFFICER_PASSWORD, with no
// database in the loop so it is unit-testable. `storedHash` is the account's
// current password hash, or null when the account does not exist yet.
//   "create" — no account exists: the seed should insert it
//   "rotate" — the account exists but the configured password no longer
//              verifies against the stored hash: the seed should overwrite
//              ONLY passwordHash (never id, name, role, or other records)
//   "noop"   — the stored hash already verifies the configured password, so
//              a repeated seed must change nothing
export async function resolveSeedPasswordAction(
  configuredPassword: string,
  storedHash: string | null,
): Promise<"create" | "rotate" | "noop"> {
  if (!storedHash) return "create";
  return (await verifyPassword(configuredPassword, storedHash)) ? "noop" : "rotate";
}

// Used to verify against when no account matches the submitted email, so a
// login attempt for a nonexistent email takes about as long as one for a
// real email with a wrong password — avoids leaking which emails exist via
// response timing.
export const DUMMY_PASSWORD_HASH = await hashPassword(randomBytes(32).toString("hex"));

export const SESSION_COOKIE_NAME = "worktruth_session";
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

// The single place the session cookie's attributes are defined, so the
// `Set-Cookie` on login and the clearing `Set-Cookie` on logout always
// agree. httpOnly is non-negotiable (JS must never read the token).
//
// Local dev (frontend + API same origin via the Vite proxy): SameSite=Lax
// over http — unchanged from before.
//
// Cross-origin deployment (a static frontend calling the API on another
// domain — signalled by CORS_ORIGIN being set): the browser only sends the
// cookie on those cross-site XHRs when it is SameSite=None, and SameSite=None
// is only accepted alongside Secure. Render serves every service over HTTPS,
// so this holds there. NODE_ENV=production also forces Secure on its own.
export function sessionCookieOptions() {
  const crossOrigin = Boolean(process.env.CORS_ORIGIN);
  return {
    httpOnly: true as const,
    sameSite: (crossOrigin ? "none" : "lax") as "none" | "lax",
    secure: crossOrigin || process.env.NODE_ENV === "production",
    path: "/",
  };
}

export type SessionUser = {
  id: number;
  name: string;
  email: string;
  role: string;
};

export async function createSession(userId: number): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await db.insert(sessionsTable).values({ token, userId, expiresAt });
  return { token, expiresAt };
}

export async function getSessionUser(token: string | undefined): Promise<SessionUser | null> {
  if (!token) return null;
  const [row] = await db
    .select({
      id: usersTable.id,
      name: usersTable.name,
      email: usersTable.email,
      role: usersTable.role,
      isActive: usersTable.isActive,
      expiresAt: sessionsTable.expiresAt,
    })
    .from(sessionsTable)
    .innerJoin(usersTable, eq(sessionsTable.userId, usersTable.id))
    .where(eq(sessionsTable.token, token));
  if (!row) return null;
  if (row.expiresAt.getTime() < Date.now()) {
    await deleteSession(token);
    return null;
  }
  // A disabled account has no valid session from this point on, even one
  // issued before it was disabled — disabling an admin's session-based
  // access takes effect immediately, not just at their next login attempt.
  if (!row.isActive) {
    await deleteSession(token);
    return null;
  }
  return { id: row.id, name: row.name, email: row.email, role: row.role };
}

export async function deleteSession(token: string | undefined): Promise<void> {
  if (!token) return;
  await db.delete(sessionsTable).where(eq(sessionsTable.token, token));
}
