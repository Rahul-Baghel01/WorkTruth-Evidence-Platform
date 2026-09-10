import "./test-env";
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { hashPassword, verifyPassword, resolveSeedPasswordAction, normalizeEmail } from "./auth";

describe("normalizeEmail", () => {
  test("lowercases and trims so seed-time and login-time lookups agree", () => {
    assert.equal(normalizeEmail("  Officer@Example.COM "), "officer@example.com");
    assert.equal(normalizeEmail("rahulbtechpsit@gmail.com"), "rahulbtechpsit@gmail.com");
  });

  test("is idempotent", () => {
    const once = normalizeEmail("  Mixed.Case@Example.com ");
    assert.equal(normalizeEmail(once), once);
  });
});

describe("password hashing", () => {
  test("verifyPassword accepts the exact password that was hashed", async () => {
    const hash = await hashPassword("correct horse battery staple");
    assert.equal(await verifyPassword("correct horse battery staple", hash), true);
  });

  test("verifyPassword rejects a wrong password", async () => {
    const hash = await hashPassword("correct horse battery staple");
    assert.equal(await verifyPassword("Correct Horse Battery Staple", hash), false);
    assert.equal(await verifyPassword("", hash), false);
  });

  test("each hash is uniquely salted, so the same password hashes differently every time", async () => {
    const a = await hashPassword("same-password");
    const b = await hashPassword("same-password");
    assert.notEqual(a, b);
    assert.equal(await verifyPassword("same-password", a), true);
    assert.equal(await verifyPassword("same-password", b), true);
  });

  test("verifyPassword rejects a malformed stored hash instead of throwing", async () => {
    assert.equal(await verifyPassword("x", "not-a-real-hash"), false);
    assert.equal(await verifyPassword("x", ""), false);
  });
});

describe("resolveSeedPasswordAction (seed officer password lifecycle)", () => {
  test("no existing account -> create", async () => {
    assert.equal(await resolveSeedPasswordAction("RahulBaghel19", null), "create");
  });

  test("existing account whose hash already matches the configured password -> noop (seed stays idempotent)", async () => {
    const storedHash = await hashPassword("RahulBaghel19");
    assert.equal(await resolveSeedPasswordAction("RahulBaghel19", storedHash), "noop");
  });

  test("existing account whose hash no longer matches -> rotate", async () => {
    const storedHash = await hashPassword("an-old-password");
    assert.equal(await resolveSeedPasswordAction("a-new-password", storedHash), "rotate");
  });

  test("after a rotate, a fresh hash of the configured password verifies (and the old one no longer does)", async () => {
    const oldHash = await hashPassword("an-old-password");
    assert.equal(await resolveSeedPasswordAction("a-new-password", oldHash), "rotate");

    const rotatedHash = await hashPassword("a-new-password");
    assert.equal(await verifyPassword("a-new-password", rotatedHash), true);
    assert.equal(await verifyPassword("an-old-password", rotatedHash), false);
    // A second seed run against the rotated hash is a no-op.
    assert.equal(await resolveSeedPasswordAction("a-new-password", rotatedHash), "noop");
  });
});
