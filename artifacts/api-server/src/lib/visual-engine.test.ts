import "./test-env";
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { evaluateVisualEvidence, type PeerVisualImage, type RawVisualImage } from "./visual-engine";

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

describe("cross-project evidence reuse", () => {
  const current: RawVisualImage[] = [{ id: 10, sha256: "aaa", perceptualHash: HASH_A, capturedAt: "2024-06-01T00:00:00Z" }];
  const peer = (overrides: Partial<PeerVisualImage> = {}): PeerVisualImage => ({
    id: 99,
    projectId: "P-9999",
    projectName: "Earlier project",
    sha256: "bbb",
    perceptualHash: HASH_NEAR,
    capturedAt: "2024-01-01T00:00:00Z",
    ...overrides,
  });

  test("no peer images -> no cross-project match, and the lens stays clean", () => {
    const result = evaluateVisualEvidence(current, []);
    assert.equal(result.crossProjectMatch, null);
    assert.ok(!result.checks.some((c) => c.name === "cross_project_duplicate_evidence"));
  });

  test("a near-duplicate in another project is reported with the measured similarity", () => {
    const result = evaluateVisualEvidence(current, [peer()]);
    const match = result.crossProjectMatch;
    assert.ok(match);
    assert.equal(match.matchedProjectId, "P-9999");
    assert.equal(match.matchedImageId, 99);
    assert.equal(match.currentImageId, 10);
    // HASH_NEAR differs from HASH_A in exactly 5 of 64 bits.
    assert.equal(match.hammingDistance, 5);
    assert.equal(match.hashBits, 64);
    assert.equal(match.similarityPercent, Math.round(((64 - 5) / 64) * 1000) / 10);
    assert.equal(match.isExactDuplicate, false);
    assert.ok(result.checks.some((c) => c.name === "cross_project_duplicate_evidence" && c.severity === "HIGH"));
    assert.equal(result.status, "REQUIRES_VERIFICATION");
  });

  test("a visually unrelated image in another project is not a match", () => {
    const result = evaluateVisualEvidence(current, [peer({ perceptualHash: HASH_FAR })]);
    assert.equal(result.crossProjectMatch, null);
  });

  test("an identical file in another project is reported as an exact duplicate", () => {
    const result = evaluateVisualEvidence(current, [peer({ sha256: "aaa", perceptualHash: HASH_A })]);
    assert.ok(result.crossProjectMatch?.isExactDuplicate);
    assert.equal(result.crossProjectMatch?.hammingDistance, 0);
    assert.equal(result.crossProjectMatch?.similarityPercent, 100);
  });

  test("the closest peer wins when several are within threshold", () => {
    const result = evaluateVisualEvidence(current, [
      peer({ id: 1, projectId: "P-FAR", perceptualHash: "1".repeat(7) + "0".repeat(57) }),
      peer({ id: 2, projectId: "P-CLOSE", perceptualHash: "1".repeat(2) + "0".repeat(62) }),
    ]);
    assert.equal(result.crossProjectMatch?.matchedProjectId, "P-CLOSE");
    assert.equal(result.crossProjectMatch?.hammingDistance, 2);
  });

  test("the reported similarity is derived from the hashes, never asserted", () => {
    // Same pair of images, evaluated twice — the percentage is a pure function
    // of the two stored hashes, so it cannot drift or be set from outside.
    const a = evaluateVisualEvidence(current, [peer()]);
    const b = evaluateVisualEvidence(current, [peer()]);
    assert.deepEqual(a.crossProjectMatch, b.crossProjectMatch);
  });
});
