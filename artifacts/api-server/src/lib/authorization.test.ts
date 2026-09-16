import "./test-env";
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  ASSIGNABLE_ROLES,
  countActiveAdmins,
  isAdmin,
  isGuest,
  isLastActiveAdmin,
  isReadOnlyRole,
  isValidRole,
  ROLES,
  type AdminGuardUser,
} from "./authorization";

describe("ROLES / isValidRole", () => {
  test("the closed role set is exactly ADMIN/OFFICER/VERIFIER/VIEWER/GUEST", () => {
    assert.deepEqual([...ROLES], ["ADMIN", "OFFICER", "VERIFIER", "VIEWER", "GUEST"]);
  });

  test("GUEST is a real role but is never offered as an assignable one", () => {
    assert.equal(isValidRole("GUEST"), true);
    assert.deepEqual([...ASSIGNABLE_ROLES], ["ADMIN", "OFFICER", "VERIFIER", "VIEWER"]);
    assert.equal(ASSIGNABLE_ROLES.includes("GUEST" as never), false);
  });

  test("accepts every declared role", () => {
    for (const role of ROLES) assert.equal(isValidRole(role), true);
  });

  test("rejects anything outside the set, including legacy free-text roles", () => {
    assert.equal(isValidRole("District Monitoring Officer"), false);
    assert.equal(isValidRole("admin"), false); // case-sensitive
    assert.equal(isValidRole(""), false);
    assert.equal(isValidRole("SUPERADMIN"), false);
  });
});

describe("isAdmin", () => {
  test("true only for the ADMIN role", () => {
    assert.equal(isAdmin("ADMIN"), true);
    assert.equal(isAdmin("OFFICER"), false);
    assert.equal(isAdmin("VERIFIER"), false);
    assert.equal(isAdmin("VIEWER"), false);
    assert.equal(isAdmin(""), false);
  });
});

function user(id: number, role: string, isActive = true): AdminGuardUser {
  return { id, role, isActive };
}

describe("countActiveAdmins", () => {
  test("counts only ADMIN rows that are also active", () => {
    const users = [user(1, "ADMIN"), user(2, "ADMIN", false), user(3, "OFFICER"), user(4, "ADMIN")];
    assert.equal(countActiveAdmins(users), 2);
  });

  test("zero when there are no admins at all", () => {
    assert.equal(countActiveAdmins([user(1, "OFFICER"), user(2, "VIEWER")]), 0);
  });
});

describe("isLastActiveAdmin — the last-administrator safeguard (disable + role change)", () => {
  test("true: the sole active admin, in a single-admin system", () => {
    const users = [user(1, "ADMIN"), user(2, "OFFICER"), user(3, "VIEWER")];
    assert.equal(isLastActiveAdmin(users, 1), true);
  });

  test("false: an active admin, but another active admin also exists", () => {
    const users = [user(1, "ADMIN"), user(2, "ADMIN"), user(3, "OFFICER")];
    assert.equal(isLastActiveAdmin(users, 1), false);
    assert.equal(isLastActiveAdmin(users, 2), false);
  });

  test("false: the target is not an admin at all", () => {
    const users = [user(1, "ADMIN"), user(2, "OFFICER")];
    assert.equal(isLastActiveAdmin(users, 2), false);
  });

  test("false: the target is an admin but already disabled (not counted, nothing to protect)", () => {
    const users = [user(1, "ADMIN", false), user(2, "OFFICER")];
    assert.equal(isLastActiveAdmin(users, 1), false);
  });

  test("false: a disabled second admin doesn't save the active one from being 'last' — but it also isn't itself protected", () => {
    // Sole ACTIVE admin among a disabled admin + others: still the last one.
    const users = [user(1, "ADMIN"), user(2, "ADMIN", false), user(3, "VERIFIER")];
    assert.equal(isLastActiveAdmin(users, 1), true);
    assert.equal(isLastActiveAdmin(users, 2), false); // id 2 is disabled, not an active admin itself
  });

  test("false: unknown user id", () => {
    assert.equal(isLastActiveAdmin([user(1, "ADMIN")], 999), false);
  });

  test("applies identically whether the actor is disabling themselves or someone else disables them — same rule either way", () => {
    // The function only looks at target/list shape, never "who is asking" —
    // that's exactly what makes "never let self-disable strand the system"
    // and "never let anyone strand the system" the same guarantee.
    const soleAdmin = [user(7, "ADMIN")];
    assert.equal(isLastActiveAdmin(soleAdmin, 7), true);
  });
});

describe("read-only roles (guest demo / viewer)", () => {
  test("VIEWER and GUEST are read-only; every other role may write", () => {
    assert.equal(isReadOnlyRole("VIEWER"), true);
    assert.equal(isReadOnlyRole("GUEST"), true);
    assert.equal(isReadOnlyRole("ADMIN"), false);
    assert.equal(isReadOnlyRole("OFFICER"), false);
    assert.equal(isReadOnlyRole("VERIFIER"), false);
  });

  test("read-only is matched exactly, never by case or prefix", () => {
    assert.equal(isReadOnlyRole("guest"), false);
    assert.equal(isReadOnlyRole("GUESTS"), false);
    assert.equal(isReadOnlyRole(""), false);
  });

  test("isGuest identifies only the guest role", () => {
    assert.equal(isGuest("GUEST"), true);
    assert.equal(isGuest("VIEWER"), false);
    assert.equal(isGuest("ADMIN"), false);
  });

  test("an admin is never accidentally read-only", () => {
    // Guards the pairing the mutation middleware depends on: the roles that
    // manage users must always be able to write.
    for (const role of ASSIGNABLE_ROLES) {
      if (isAdmin(role)) assert.equal(isReadOnlyRole(role), false);
    }
  });
});
