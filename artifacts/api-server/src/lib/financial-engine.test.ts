import "./test-env";
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { evaluateFinancialEvidence, mad, mean, median, percentileRank, standardDeviation, type RawFinancialRecord } from "./financial-engine";

describe("robust statistics", () => {
  test("median of an odd-length array", () => {
    assert.equal(median([3, 1, 2]), 2);
  });

  test("median of an even-length array averages the two middle values", () => {
    assert.equal(median([1, 2, 3, 4]), 2.5);
  });

  test("median of an empty array is null", () => {
    assert.equal(median([]), null);
  });

  test("mean", () => {
    assert.equal(mean([1, 2, 3]), 2);
  });

  test("standardDeviation requires at least two values", () => {
    assert.equal(standardDeviation([5]), null);
    assert.ok((standardDeviation([1, 2, 3, 4, 5]) ?? 0) > 0);
  });

  test("mad of a constant array is 0", () => {
    assert.equal(mad([5, 5, 5, 5]), 0);
  });

  test("percentileRank places the maximum value at 100", () => {
    assert.equal(percentileRank([1, 2, 3, 4, 5], 5), 100);
  });

  test("percentileRank of an empty peer set is null", () => {
    assert.equal(percentileRank([], 5), null);
  });
});

describe("evaluateFinancialEvidence", () => {
  const noPeers = { dimension: "category + district", ratios: [] as number[] };

  test("A. normal project (sanction >= expenditure, no ledger): no anomaly", () => {
    const project = { sanctionAmount: 1_000_000, expenditure: 800_000 };
    const result = evaluateFinancialEvidence(project, [], noPeers);
    assert.equal(result.evidenceLevel, "BASIC");
    assert.equal(result.status, "WITHIN_EXPECTED_RANGE");
    assert.ok(result.score !== null && result.score < 0.35);
    assert.ok(!result.checks.some((c) => c.severity === "HIGH" || c.severity === "MODERATE"));
  });

  test("B. expenditure exceeds sanction is flagged HIGH", () => {
    const project = { sanctionAmount: 1_000_000, expenditure: 1_400_000 };
    const result = evaluateFinancialEvidence(project, [], noPeers);
    assert.equal(result.status, "ANOMALY_DETECTED");
    assert.ok(result.checks.some((c) => c.name === "expenditure_exceeds_sanction" && c.severity === "HIGH"));
    assert.ok(result.reasons.some((r) => r.includes("exceeds sanctioned amount")));
  });

  test("C. payment exceeds expenditure is flagged HIGH", () => {
    const project = { sanctionAmount: 1_000_000, expenditure: 500_000 };
    const records: RawFinancialRecord[] = [
      { id: 1, type: "SANCTION", amount: 1_000_000, recordedDate: "2024-01-01" },
      { id: 2, type: "EXPENDITURE", amount: 500_000, recordedDate: "2024-02-01" },
      { id: 3, type: "PAYMENT", amount: 700_000, recordedDate: "2024-02-15" },
    ];
    const result = evaluateFinancialEvidence(project, records, noPeers);
    assert.equal(result.evidenceLevel, "DETAILED");
    assert.ok(result.checks.some((c) => c.name === "payment_exceeds_expenditure" && c.severity === "HIGH"));
  });

  test("D. duplicate financial record is flagged HIGH with both record IDs", () => {
    const project = { sanctionAmount: 1_000_000, expenditure: 500_000 };
    const records: RawFinancialRecord[] = [
      { id: 1, type: "EXPENDITURE", amount: 250_000, recordedDate: "2024-02-01" },
      { id: 2, type: "EXPENDITURE", amount: 250_000, recordedDate: "2024-02-01" },
    ];
    const result = evaluateFinancialEvidence(project, records, noPeers);
    const duplicate = result.checks.find((c) => c.name === "duplicate_records");
    assert.ok(duplicate);
    assert.equal(duplicate?.severity, "HIGH");
    assert.deepEqual([...(duplicate?.supportingRecordIds ?? [])].sort(), [1, 2]);
  });

  test("E. unusual peer expenditure ratio is flagged as an outlier", () => {
    const project = { sanctionAmount: 1_000_000, expenditure: 950_000 }; // ratio 0.95
    const peerRatios = [0.5, 0.52, 0.48, 0.55, 0.5, 0.51, 0.49, 0.5, 0.53, 0.5]; // tight cluster ~0.5
    const result = evaluateFinancialEvidence(project, [], { dimension: "category", ratios: peerRatios });
    assert.ok(result.peerGroup.percentileRank !== null && result.peerGroup.percentileRank >= 95);
    assert.ok(result.checks.some((c) => c.name === "peer_outlier_high"));
    assert.equal(result.status, "ANOMALY_DETECTED");
  });

  test("F. insufficient evidence (no ledger, no usable scalar amounts)", () => {
    const project = { sanctionAmount: 0, expenditure: 0 };
    const result = evaluateFinancialEvidence(project, [], noPeers);
    assert.equal(result.evidenceLevel, "NONE");
    assert.equal(result.status, "INSUFFICIENT_EVIDENCE");
    assert.equal(result.score, null);
    assert.equal(result.confidence, 0);
  });

  test("G. invalid financial records are excluded, not silently used", () => {
    const project = { sanctionAmount: 1_000_000, expenditure: 500_000 };
    const records: RawFinancialRecord[] = [
      { id: 1, type: "EXPENDITURE", amount: -500, recordedDate: "2024-01-01" }, // invalid: negative amount
      { id: 2, type: "EXPENDITURE", amount: 500_000, recordedDate: "not-a-date" }, // invalid: bad date
      { id: 3, type: "BOGUS", amount: 100, recordedDate: "2024-01-01" }, // invalid: unknown type
    ];
    const result = evaluateFinancialEvidence(project, records, noPeers);
    assert.equal(result.recordCount, 0);
    const excluded = result.checks.find((c) => c.name === "invalid_records_excluded");
    assert.ok(excluded);
    assert.match(excluded!.message, /3 financial records/);
  });

  test("H. a completely new project ID gets no special-cased behavior", () => {
    // evaluateFinancialEvidence never receives a project id at all — the
    // same evidence must produce the same result no matter which project
    // this is. This directly guards against reintroducing the old
    // is1089/is4150/is3022-style ID branching.
    const project = { sanctionAmount: 2_700_000, expenditure: 2_680_000 };
    const records: RawFinancialRecord[] = [
      { id: 1, type: "SANCTION", amount: 2_700_000, recordedDate: "2024-01-15" },
      { id: 2, type: "EXPENDITURE", amount: 2_680_000, recordedDate: "2024-06-01" },
    ];
    const peers = { dimension: "category + district", ratios: [0.9, 0.92, 0.88, 0.95] };
    const resultA = evaluateFinancialEvidence(project, records, peers);
    const resultB = evaluateFinancialEvidence(project, records, peers);
    assert.deepEqual(resultA.checks.map((c) => c.name), resultB.checks.map((c) => c.name));
    assert.equal(resultA.score, resultB.score);
    assert.equal(resultA.status, resultB.status);
    // Sanity check this isn't accidentally landing on one of the old
    // hardcoded per-project constants (0.7 / 0.63 / 0.43) from before P0-E.
    assert.notEqual(resultA.score, 0.7);
    assert.notEqual(resultA.score, 0.63);
    assert.notEqual(resultA.score, 0.43);
  });
});

describe("peer cost benchmark (sanctioned amount vs comparable projects)", () => {
  const ratios = [0.95, 0.96, 0.94, 0.93];
  const project = { sanctionAmount: 2_700_000, expenditure: 2_680_000 };

  test("the cost ratio is the project's sanction over the peer MEDIAN sanction", () => {
    const sanctions = [1_120_000, 1_150_000, 1_200_000, 2_250_000]; // median 1,175,000
    const result = evaluateFinancialEvidence(project, [], { dimension: "category + district", ratios, sanctions });
    assert.equal(result.peerGroup.medianSanction, 1_175_000);
    assert.ok(result.peerGroup.costRatio !== null);
    // 2,700,000 / 1,175,000 = 2.298..., i.e. the "2.3x benchmark" figure.
    assert.equal(Number(result.peerGroup.costRatio?.toFixed(1)), 2.3);
  });

  test("a sanction at or above 2x the peer median raises a HIGH cost check", () => {
    const sanctions = [1_120_000, 1_150_000, 1_200_000, 2_250_000];
    const result = evaluateFinancialEvidence(project, [], { dimension: "category + district", ratios, sanctions });
    const check = result.checks.find((c) => c.name === "cost_above_peer_benchmark");
    assert.ok(check);
    assert.equal(check?.severity, "HIGH");
    assert.equal(check?.observed?.peerMedianSanction, 1_175_000);
    assert.ok(check?.message.includes("2.3×"));
  });

  test("a moderately elevated sanction is MODERATE, not HIGH", () => {
    // 1,900,000 / 1,175,000 = 1.62x -> above the 1.5x bar, below the 2x bar.
    const result = evaluateFinancialEvidence({ sanctionAmount: 1_900_000, expenditure: 1_800_000 }, [], {
      dimension: "category",
      ratios,
      sanctions: [1_120_000, 1_150_000, 1_200_000, 2_250_000],
    });
    assert.equal(result.checks.find((c) => c.name === "cost_above_peer_benchmark")?.severity, "MODERATE");
  });

  test("a sanction in line with its peers raises no cost check", () => {
    const result = evaluateFinancialEvidence({ sanctionAmount: 1_180_000, expenditure: 1_100_000 }, [], {
      dimension: "category",
      ratios,
      sanctions: [1_120_000, 1_150_000, 1_200_000, 2_250_000],
    });
    assert.ok(!result.checks.some((c) => c.name === "cost_above_peer_benchmark"));
    assert.equal(result.peerGroup.costRatio !== null, true);
  });

  test("no benchmark is computed below the minimum peer count, and none is invented", () => {
    const result = evaluateFinancialEvidence(project, [], { dimension: "category", ratios: [0.95, 0.96], sanctions: [1_120_000, 1_150_000] });
    assert.equal(result.peerGroup.medianSanction, null);
    assert.equal(result.peerGroup.costRatio, null);
    assert.ok(!result.checks.some((c) => c.name === "cost_above_peer_benchmark"));
  });

  test("callers that supply no peer sanctions are unaffected", () => {
    const result = evaluateFinancialEvidence(project, [], { dimension: "category", ratios });
    assert.equal(result.peerGroup.medianSanction, null);
    assert.equal(result.peerGroup.costRatio, null);
    assert.ok(!result.checks.some((c) => c.name === "cost_above_peer_benchmark"));
  });
});
