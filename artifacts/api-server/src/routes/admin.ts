// Admin User Management — server-side authorization is the actual security
// boundary here (requireAuth + requireAdmin below), never the frontend
// hiding a nav item or button. Every handler in this file only ever reads
// email/name/role/isActive/createdAt off a user row — passwordHash is never
// selected, never returned, never logged.
import { Router, type IRouter } from "express";
import { asc, eq } from "drizzle-orm";
import { db, sessionsTable, usersTable, type UserRow } from "@workspace/db";
import {
  CreateUserBody,
  CreateUserResponse,
  ListUsersResponse,
  UpdateUserRoleBody,
  UpdateUserRoleParams,
  UpdateUserRoleResponse,
  UpdateUserStatusBody,
  UpdateUserStatusParams,
  UpdateUserStatusResponse,
} from "@workspace/api-zod";
import { hashPassword, normalizeEmail } from "../lib/auth";
import { isGuest, isLastActiveAdmin } from "../lib/authorization";
import { requireAdmin, requireAuth } from "../middlewares/auth";

const router: IRouter = Router();

// Authentication, then authorization — both required, in that order, and
// self-contained in this router regardless of where it ends up mounted
// (worktruth.ts applies requireAuth to itself via `router.use`, but that is
// scoped to that router instance only; this router needs its own).
router.use(requireAuth, requireAdmin);

function toManagedUser(row: Pick<UserRow, "id" | "name" | "email" | "role" | "isActive" | "createdAt">) {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
    isActive: row.isActive,
    createdAt: row.createdAt.toISOString(),
  };
}

router.get("/admin/users", async (_req, res): Promise<void> => {
  const rows = await db
    .select({ id: usersTable.id, name: usersTable.name, email: usersTable.email, role: usersTable.role, isActive: usersTable.isActive, createdAt: usersTable.createdAt })
    .from(usersTable)
    .orderBy(asc(usersTable.createdAt));
  res.json(ListUsersResponse.parse(rows.map(toManagedUser)));
});

router.post("/admin/users", async (req, res): Promise<void> => {
  const parsed = CreateUserBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  // GUEST is not an assignable role — it exists only for the shared demo
  // account the guest-login endpoint issues sessions for, and handing it to a
  // real user would silently make that account read-only.
  if (isGuest(parsed.data.role)) {
    res.status(400).json({ error: "GUEST is not an assignable role." });
    return;
  }
  const email = normalizeEmail(parsed.data.email);
  const [existing] = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.email, email));
  if (existing) {
    res.status(409).json({ error: "A user with this email already exists." });
    return;
  }
  // Hashed with the exact same scrypt implementation every other account
  // (seeded or self-registered-in-the-future) uses — see lib/auth.ts. The
  // plaintext is never stored, logged, or included in the response below.
  const passwordHash = await hashPassword(parsed.data.password);
  const [created] = await db
    .insert(usersTable)
    .values({ email, name: parsed.data.name.trim(), role: parsed.data.role, passwordHash, isActive: true })
    .returning({ id: usersTable.id, name: usersTable.name, email: usersTable.email, role: usersTable.role, isActive: usersTable.isActive, createdAt: usersTable.createdAt });
  // Deliberately no session is created here — the new account signs in
  // itself, normally, at the existing /auth/login page.
  res.status(201).json(CreateUserResponse.parse(toManagedUser(created)));
});

router.patch("/admin/users/:id/status", async (req, res): Promise<void> => {
  const params = UpdateUserStatusParams.safeParse(req.params);
  const body = UpdateUserStatusBody.safeParse(req.body);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  const allUsers = await db.select({ id: usersTable.id, role: usersTable.role, isActive: usersTable.isActive }).from(usersTable);
  const [target] = allUsers.filter((row) => row.id === params.data.id);
  if (!target) {
    res.status(404).json({ error: "User not found" });
    return;
  }
  if (!body.data.isActive && isLastActiveAdmin(allUsers, params.data.id)) {
    res.status(400).json({ error: "Cannot disable the last active administrator." });
    return;
  }
  const [updated] = await db
    .update(usersTable)
    .set({ isActive: body.data.isActive })
    .where(eq(usersTable.id, params.data.id))
    .returning({ id: usersTable.id, name: usersTable.name, email: usersTable.email, role: usersTable.role, isActive: usersTable.isActive, createdAt: usersTable.createdAt });
  // Disabling takes effect immediately, not just on the account's next login
  // attempt — drop every session it currently holds. (getSessionUser also
  // re-checks isActive on every request, so this is defense in depth, not
  // the only enforcement — see lib/auth.ts.)
  if (!body.data.isActive) {
    await db.delete(sessionsTable).where(eq(sessionsTable.userId, params.data.id));
  }
  res.json(UpdateUserStatusResponse.parse(toManagedUser(updated)));
});

router.patch("/admin/users/:id/role", async (req, res): Promise<void> => {
  const params = UpdateUserRoleParams.safeParse(req.params);
  const body = UpdateUserRoleBody.safeParse(req.body);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  const allUsers = await db.select({ id: usersTable.id, role: usersTable.role, isActive: usersTable.isActive }).from(usersTable);
  const [target] = allUsers.filter((row) => row.id === params.data.id);
  if (!target) {
    res.status(404).json({ error: "User not found" });
    return;
  }
  // GUEST is not an assignable role — it exists only for the shared demo
  // account, and handing it to a real user would silently make that account
  // read-only.
  if (isGuest(body.data.role)) {
    res.status(400).json({ error: "GUEST is not an assignable role." });
    return;
  }
  // Demoting the last active admin away from ADMIN carries the exact same
  // risk as disabling them — both leave WorkTruth with zero administrators.
  if (body.data.role !== "ADMIN" && isLastActiveAdmin(allUsers, params.data.id)) {
    res.status(400).json({ error: "Cannot change the last active administrator's role — no administrator would remain." });
    return;
  }
  const [updated] = await db
    .update(usersTable)
    .set({ role: body.data.role })
    .where(eq(usersTable.id, params.data.id))
    .returning({ id: usersTable.id, name: usersTable.name, email: usersTable.email, role: usersTable.role, isActive: usersTable.isActive, createdAt: usersTable.createdAt });
  res.json(UpdateUserRoleResponse.parse(toManagedUser(updated)));
});

export default router;
