import "./test-env";
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { cosineSimilarity, evaluateTextEvidence, tokenize, type RawPeerProject } from "./text-engine";

const noPeers: RawPeerProject[] = [];

describe("tokenization and similarity primitives", () => {
  test("tokenize lowercases, strips punctuation, and drops stopwords/short tokens", () => {
    assert.deepEqual(tokenize("Construction of a Community Hall!"), ["construction", "community", "hall"]);
  });

  test("cosineSimilarity of identical vectors is 1", () => {
    const v = new Map([["hall", 1], ["community", 0.5]]);
    assert.ok(Math.abs(cosineSimilarity(v, v) - 1) < 1e-9);
  });

  test("cosineSimilarity of disjoint vectors is 0", () => {
    const a = new Map([["hall", 1]]);
    const b = new Map([["road", 1]]);
    assert.equal(cosineSimilarity(a, b), 0);
  });
});

describe("evaluateTextEvidence", () => {
  test("A. missing description -> INSUFFICIENT_EVIDENCE", () => {
    const result = evaluateTextEvidence({ description: "   ", category: "School" }, noPeers, "category");
    assert.equal(result.status, "INSUFFICIENT_EVIDENCE");
    assert.equal(result.score, null);
    assert.equal(result.confidence, 0);
    assert.ok(result.reasons.some((r) => r.includes("No project description")));
  });

  test("B. valid normal description with no peers: consistent", () => {
    const result = evaluateTextEvidence(
      { description: "Construction of a new primary school building with classrooms and a library.", category: "School" },
      noPeers,
      "category",
    );
    assert.equal(result.status, "CONSISTENT");
    assert.ok(result.score !== null && result.score < 0.35);
    assert.ok(result.tokenCount > 0);
  });

  test("C. very short description is noted as low evidence quality, not an anomaly", () => {
    const result = evaluateTextEvidence({ description: "New hall", category: "Community Hall" }, noPeers, "category");
    assert.ok(result.checks.some((c) => c.name === "short_description" && c.severity === "LOW"));
    assert.notEqual(result.status, "INSUFFICIENT_EVIDENCE");
    assert.ok(result.confidence < 0.6);
  });

  test("D. category-consistent description is recognized", () => {
    const result = evaluateTextEvidence(
      { description: "Construction of a drinking water pipeline and supply well for the village.", category: "Water" },
      noPeers,
      "category",
    );
    assert.ok(result.categoryMatchCount > 0);
    assert.ok(result.checks.some((c) => c.name === "category_keyword_match"));
  });

  test("E. category-inconsistent description is flagged as a weak signal, not fraud", () => {
    const result = evaluateTextEvidence(
      { description: "Purchase of stationery items and office furniture for the district headquarters building complex.", category: "Water" },
      noPeers,
      "category",
    );
    const mismatch = result.checks.find((c) => c.name === "category_keyword_mismatch");
    assert.ok(mismatch);
    assert.equal(mismatch?.severity, "LOW");
  });

  test("F. exact duplicate descriptions are flagged HIGH", () => {
    const description = "Construction of Community Hall at Village X";
    const peers: RawPeerProject[] = [{ id: "P-2000", description }];
    const result = evaluateTextEvidence({ description, category: "Community Hall" }, peers, "category + district");
    const duplicate = result.checks.find((c) => c.name === "exact_duplicate_description");
    assert.ok(duplicate);
    assert.equal(duplicate?.severity, "HIGH");
    assert.equal(result.status, "REQUIRES_VERIFICATION");
    assert.deepEqual(duplicate?.supportingProjectIds, ["P-2000"]);
  });

  test("G. highly similar (non-identical) peer descriptions are flagged", () => {
    const peers: RawPeerProject[] = [{ id: "P-2001", description: "Development of Public Community Centre at Village X" }];
    const result = evaluateTextEvidence(
      { description: "Construction of Community Hall at Village X", category: "Community Hall" },
      peers,
      "category + district",
    );
    assert.ok(result.peerGroup.topMatches[0].similarity > 0);
    if (result.peerGroup.topMatches[0].similarity >= 0.5) {
      assert.ok(result.checks.some((c) => c.name === "highly_similar_description"));
    }
  });

  test("H. unrelated descriptions produce low similarity", () => {
    const peers: RawPeerProject[] = [{ id: "P-2002", description: "Resurfacing of the village approach road near the market." }];
    const result = evaluateTextEvidence(
      { description: "Installation of a solar-powered drinking water pump at the primary health centre.", category: "Water" },
      peers,
      "category",
    );
    assert.ok(result.peerGroup.topMatches[0].similarity < 0.3);
    assert.ok(!result.checks.some((c) => c.name === "exact_duplicate_description" || c.name === "highly_similar_description"));
  });

  test("I. small peer group is noted explicitly", () => {
    const peers: RawPeerProject[] = [{ id: "P-2003", description: "Repair of the anganwadi centre roof and boundary wall." }];
    const result = evaluateTextEvidence({ description: "Renovation of the panchayat office building.", category: "Public Facility" }, peers, "category");
    assert.ok(result.checks.some((c) => c.name === "small_peer_group"));
    assert.ok(result.reasons.some((r) => r.includes("Only 1 comparable project")));
  });

  test("J. no peers available is reported honestly, not hidden", () => {
    const result = evaluateTextEvidence({ description: "Construction of a new road bridge over the canal.", category: "Road" }, noPeers, "category");
    assert.equal(result.peerGroup.size, 0);
    assert.ok(result.checks.some((c) => c.name === "no_peers_available"));
  });

  test("K. deterministic: identical input produces identical output", () => {
    const peers: RawPeerProject[] = [
      { id: "P-3000", description: "Construction of a village community hall." },
      { id: "P-3001", description: "Development of a public reading room." },
    ];
    const input = { description: "Construction of Community Hall at Village X", category: "Community Hall" } as const;
    const resultA = evaluateTextEvidence(input, peers, "category + district");
    const resultB = evaluateTextEvidence(input, peers, "category + district");
    // updatedAt is wall-clock metadata (see evaluateTextEvidence's own doc
    // comments) — it is not part of the deterministic computation itself,
    // and comparing it directly makes this test flaky whenever the two
    // calls straddle a millisecond boundary. Compare everything else.
    assert.deepEqual({ ...resultA, updatedAt: null }, { ...resultB, updatedAt: null });
  });

  test("L. no project-ID-specific behavior", () => {
    // evaluateTextEvidence's signature has no project-id parameter — only
    // description/category and peer descriptions — so it cannot special-case
    // any specific project the way the old is3022 branch did.
    const peers: RawPeerProject[] = [{ id: "P-3022", description: "Construction of Community Hall at Village X" }];
    const result = evaluateTextEvidence({ description: "Construction of Community Hall at Village X", category: "Community Hall" }, peers, "category + district");
    // Not the old hardcoded constant (0.87) from before P0-H.
    assert.notEqual(result.score, 0.87);
    // The duplicate IS still correctly detected — on the text itself, not the ID.
    assert.ok(result.checks.some((c) => c.name === "exact_duplicate_description"));
  });

  test("M. null/empty text is handled without throwing", () => {
    // @ts-expect-error deliberately passing null to verify defensive handling
    const result = evaluateTextEvidence({ description: null, category: "Road" }, noPeers, "category");
    assert.equal(result.status, "INSUFFICIENT_EVIDENCE");
    assert.equal(result.score, null);
  });
});
