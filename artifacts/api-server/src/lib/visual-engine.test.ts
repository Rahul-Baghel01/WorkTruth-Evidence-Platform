import "./test-env";
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { evaluateVisualEvidence, type RawVisualImage } from "./visual-engine";

const HASH_A = "0".repeat(64);
// Differs from HASH_A in 5 bits — within the near-duplicate threshold (8).
const HASH_NEAR = "1".repeat(5) + "0".repeat(59);
// Differs from HASH_A in 32 bits — well beyond the near-duplicate threshold.
const HASH_FAR = "1".repeat(32) + "0".repeat(32);

describe("evaluateVisualEvidence", () => {
  test("A. no images -> INSUFFICIENT_EVIDENCE", () => {
    const result = evaluateVisualEvidence([]);
    assert.equal(result.status, "INSUFFICIENT_EVIDENCE");
    assert.equal(result.score, null);
    assert.equal(result.confidence, 0);
    assert.ok(result.reasons.some((r) => r.includes("No evidence images")));
  });

  test("B. one valid image: limited progression evidence, no anomaly", () => {
    const images: RawVisualImage[] = [{ id: 1, sha256: "aaa", perceptualHash: HASH_A, capturedAt: "2024-06-01T00:00:00Z" }];
    const result = evaluateVisualEvidence(images);
    assert.equal(result.status, "CONSISTENT");
    assert.ok(result.checks.some((c) => c.name === "single_image_limited_evidence"));
    assert.ok(result.reasons.some((r) => r.includes("only one image exists")));
  });

  test("C. multiple unique images: no anomaly", () => {
    const images: RawVisualImage[] = [
      { id: 1, sha256: "aaa", perceptualHash: HASH_A, capturedAt: "2024-06-01T00:00:00Z" },
      { id: 2, sha256: "bbb", perceptualHash: HASH_FAR, capturedAt: "2024-07-01T00:00:00Z" },
    ];
    const result = evaluateVisualEvidence(images);
    assert.equal(result.status, "CONSISTENT");
    assert.ok(!result.checks.some((c) => c.severity === "HIGH" || c.severity === "MODERATE"));
  });

  test("D. exact duplicate files (same SHA-256) are flagged HIGH", () => {
    const images: RawVisualImage[] = [
      { id: 1, sha256: "same-hash", perceptualHash: HASH_A, capturedAt: "2024-06-01T00:00:00Z" },
      { id: 2, sha256: "same-hash", perceptualHash: HASH_A, capturedAt: "2024-07-01T00:00:00Z" },
    ];
    const result = evaluateVisualEvidence(images);
    const check = result.checks.find((c) => c.name === "exact_duplicate_files");
    assert.ok(check);
    assert.equal(check?.severity, "HIGH");
    assert.deepEqual([...(check?.supportingImageIds ?? [])].sort(), [1, 2]);
    assert.equal(result.status, "REQUIRES_VERIFICATION");
  });

  test("E. perceptually similar (but not byte-identical) images are flagged", () => {
    const images: RawVisualImage[] = [
      { id: 1, sha256: "hash-a", perceptualHash: HASH_A, capturedAt: "2024-06-01T00:00:00Z" },
      { id: 2, sha256: "hash-b", perceptualHash: HASH_NEAR, capturedAt: "2024-06-01T00:00:00Z" },
    ];
    const result = evaluateVisualEvidence(images);
    const check = result.checks.find((c) => c.name === "near_duplicate_images");
    assert.ok(check);
    assert.equal(check?.severity, "MODERATE");
    // Not double-counted as an exact duplicate — different SHA-256.
    assert.ok(!result.checks.some((c) => c.name === "exact_duplicate_files"));
  });

  test("F. different images with missing metadata: no crash, no fabricated fields", () => {
    const images: RawVisualImage[] = [
      { id: 1, sha256: null, perceptualHash: null, capturedAt: null },
      { id: 2, sha256: null, perceptualHash: null, capturedAt: null },
    ];
    const result = evaluateVisualEvidence(images);
    assert.equal(result.imageCount, 2);
    assert.equal(result.datedImageCount, 0);
    assert.equal(result.undatedImageCount, 2);
    assert.ok(!result.checks.some((c) => c.name === "exact_duplicate_files" || c.name === "near_duplicate_images"));
  });

  test("G. valid capture timestamps are counted and reported", () => {
    const images: RawVisualImage[] = [
      { id: 1, sha256: "a", perceptualHash: HASH_A, capturedAt: "2024-06-01T00:00:00Z" },
      { id: 2, sha256: "b", perceptualHash: HASH_FAR, capturedAt: "2024-06-15T00:00:00Z" },
    ];
    const result = evaluateVisualEvidence(images);
    assert.equal(result.datedImageCount, 2);
    assert.ok(result.reasons.some((r) => r.includes("valid capture timestamps")));
  });

  test("H. missing capture timestamps are reported honestly, not treated as an anomaly", () => {
    const images: RawVisualImage[] = [{ id: 1, sha256: "a", perceptualHash: HASH_A, capturedAt: null }];
    const result = evaluateVisualEvidence(images);
    assert.equal(result.datedImageCount, 0);
    assert.equal(result.undatedImageCount, 1);
    assert.ok(result.checks.some((c) => c.name === "no_capture_metadata" && c.severity === "INFO"));
    assert.notEqual(result.status, "REQUIRES_VERIFICATION");
  });

  test("I. chronologically ordered images: earliest/latest are correctly identified", () => {
    const images: RawVisualImage[] = [
      { id: 1, sha256: "a", perceptualHash: HASH_A, capturedAt: "2024-08-01T00:00:00Z" },
      { id: 2, sha256: "b", perceptualHash: HASH_FAR, capturedAt: "2024-06-01T00:00:00Z" }, // uploaded/listed out of order
    ];
    const result = evaluateVisualEvidence(images);
    assert.equal(result.earliestCapturedAt, new Date("2024-06-01T00:00:00Z").toISOString());
    assert.equal(result.latestCapturedAt, new Date("2024-08-01T00:00:00Z").toISOString());
    assert.ok(result.reasons.some((r) => r.includes("days after the earliest image")));
  });

  test("J. a repeated (near-duplicate) image submitted at a different date is flagged as lack of visual change", () => {
    const images: RawVisualImage[] = [
      { id: 1, sha256: "a", perceptualHash: HASH_A, capturedAt: "2024-06-01T00:00:00Z" },
      { id: 2, sha256: "b", perceptualHash: HASH_NEAR, capturedAt: "2024-09-01T00:00:00Z" },
    ];
    const result = evaluateVisualEvidence(images);
    const check = result.checks.find((c) => c.name === "no_visual_change_across_dates");
    assert.ok(check);
    assert.ok(result.reasons.some((r) => r.includes("no visible change")));
  });

  test("K. a record with no usable hash/sha256 (failed extraction) does not crash or get treated as a duplicate", () => {
    const images: RawVisualImage[] = [
      { id: 1, sha256: "a", perceptualHash: HASH_A, capturedAt: "2024-06-01T00:00:00Z" },
      { id: 2, sha256: null, perceptualHash: null, capturedAt: "2024-06-02T00:00:00Z" },
    ];
    const result = evaluateVisualEvidence(images);
    assert.equal(result.imageCount, 2);
    assert.ok(!result.checks.some((c) => (c.supportingImageIds ?? []).includes(2)));
  });

  test("L. deterministic: identical input produces identical output", () => {
    const images: RawVisualImage[] = [
      { id: 1, sha256: "a", perceptualHash: HASH_A, capturedAt: "2024-06-01T00:00:00Z" },
      { id: 2, sha256: "b", perceptualHash: HASH_FAR, capturedAt: "2024-07-01T00:00:00Z" },
    ];
    const resultA = evaluateVisualEvidence(images);
    const resultB = evaluateVisualEvidence(images);
    // updatedAt is wall-clock metadata, not part of the deterministic
    // computation itself — comparing it directly makes this test flaky
    // whenever the two calls straddle a millisecond boundary.
    assert.deepEqual({ ...resultA, updatedAt: null }, { ...resultB, updatedAt: null });
  });

  test("M. no project-ID-specific behavior", () => {
    // evaluateVisualEvidence takes only image records — no project id at
    // all — so it structurally cannot special-case a specific project.
    const images: RawVisualImage[] = [{ id: 1, sha256: "a", perceptualHash: HASH_A, capturedAt: "2024-06-01T00:00:00Z" }];
    const result = evaluateVisualEvidence(images);
    // Not the old hardcoded is1089/is4150 constants (0.91 / 0.86) from before P0-I.
    assert.notEqual(result.score, 0.91);
    assert.notEqual(result.score, 0.86);
  });
});
