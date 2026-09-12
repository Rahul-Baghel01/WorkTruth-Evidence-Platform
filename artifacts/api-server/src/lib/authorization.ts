// Authorization — "what is this user's role allowed to do?" — deliberately
// kept separate from auth.ts, which only ever answers "is this a valid
// WorkTruth user with the correct password?". Nothing here touches
// passwords, hashes, or sessions; nothing in auth.ts knows about roles
// beyond passing the stored `role` string through unchanged.
//
// Pure, DB-free functions throughout, so every rule here is unit-testable
// without a database — see authorization.test.ts.

// The closed role set for admin user management. `role` on usersTable stays
// a plain `text` column (see schema/index.ts's comment on it) — this is the
// single place that set is enumerated and enforced at the API boundary.
export const ROLES = ["ADMIN", "OFFICER", "VERIFIER", "VIEWER"] as const;
export type Role = (typeof ROLES)[number];

export function isValidRole(value: string): value is Role {
  return (ROLES as readonly string[]).includes(value);
}

// ADMIN: manage users (list/create/enable/disable/change role) and every
// existing WorkTruth function. OFFICER/VERIFIER/VIEWER never reach the user-
// management API regardless of what the frontend shows or hides — routes
// enforce this themselves via requireAdmin (middlewares/auth.ts), never
// relying on the client to hide a button.
export function isAdmin(role: string): boolean {
  return role === "ADMIN";
}

export type AdminGuardUser = { id: number; role: string; isActive: boolean };

export function countActiveAdmins(users: AdminGuardUser[]): number {
  return users.filter((user) => user.role === "ADMIN" && user.isActive).length;
}

// True when `targetId` currently IS an active ADMIN and is the only one —
// i.e. disabling that account, or changing its role away from ADMIN, would
// leave WorkTruth with zero active administrators. Covers both required
// safeguards with one rule: "prevent disabling the last active admin" and
// "never let an admin disable themselves if that would remove the last
// admin" are the same condition regardless of who is performing the action
// or whether the target is the caller.
export function isLastActiveAdmin(users: AdminGuardUser[], targetId: number): boolean {
  const target = users.find((user) => user.id === targetId);
  if (!target || target.role !== "ADMIN" || !target.isActive) return false;
  return countActiveAdmins(users) <= 1;
}
