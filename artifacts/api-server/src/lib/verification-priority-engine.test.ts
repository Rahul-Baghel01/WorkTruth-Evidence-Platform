import "./test-env";
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { evaluateVerificationPriority, type VerificationPriorityInput } from "./verification-priority-engine";
import { DEFAULT_LENS_WEIGHTS, evaluateEvidenceFusion, type EvidenceFusionResult, type LensName, type NormalizedLens } from "./fusion-engine";
import { evaluateCrossModalInconsistencies, type CrossModalAnalysisResult, type CrossModalInconsistency, type InconsistencySeverity } from "./cross-modal-engine";
import type { FinancialAnalysisResult } from "./financial-engine";
import type { GeoAnalysisResult } from "./geo-engine";
import type { TemporalAnalysisResult } from "./temporal-engine";
import type { TextAnalysisResult } from "./text-engine";
import type { VisualAnalysisResult } from "./visual-engine";

// ---------------------------------------------------------------------------
// Fixture builders. verification-priority-engine.ts is a pure function of
// EvidenceFusionResult + CrossModalAnalysisResult, so the correct level to
// test it at is fixtures shaped like *those* results directly — not calls
// into the real financial/geo/temporal/text/visual compute*Analysis
// functions. One integration test near the bottom exercises the real
// fusion/cross-modal engines together to prove end-to-end compatibility.
// ---------------------------------------------------------------------------

function normalizedLens(lens: LensName, isAnomalous: boolean, overrides: Partial<NormalizedLens> = {}): NormalizedLens {
  return {
    lens,
    status: isAnomalous ? "ANOMALY_DETECTED" : "WITHIN_EXPECTED_RANGE",
    isInsufficientEvidence: false,
    isAnomalous,
    score: isAnomalous ? 0.5 : 0.05,
    confidence: 0.8,
    effectiveWeight: 0.2,
    checks: [],
    reasons: [],
    engineVersion: "test-v1",
    ...overrides,
  };
}

function fusionResult(overrides: Partial<EvidenceFusionResult> = {}): EvidenceFusionResult {
  return {
    status: "STRONG_EVIDENCE",
    overallEvidenceScore: 0.05,
    overallConfidence: 0.8,
    coverage: {
      availableLensCount: 5,
      totalLensCount: 5,
      coveragePercent: 1,
      effectiveWeightCoverage: 1,
      confidenceAdjustedCoverage: 0.8,
      availableLenses: ["financial", "geospatial", "temporal", "text", "visual"],
      unavailableLenses: [],
    },
    weights: DEFAULT_LENS_WEIGHTS,
    lenses: (["financial", "geospatial", "temporal", "text", "visual"] as LensName[]).map((l) => normalizedLens(l, false)),
    agreement: { agreeingLensCount: 0, signals: [], bonus: 0, explanation: [] },
    mixedEvidence: { isMixed: false, anomalousLenses: [], consistentLenses: [], explanation: [] },
    crossModalSummary: { count: 0, countsBySeverity: { INFO: 0, LOW: 0, MODERATE: 0, HIGH: 0, CRITICAL: 0 }, topInconsistencies: [] },
    reasons: [],
    engineVersion: "fusion-v1",
    updatedAt: "2025-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function inconsistency(overrides: Partial<CrossModalInconsistency> = {}): CrossModalInconsistency {
  return {
    id: "test-id",
    type: "financial_temporal_activity_before_sanction",
    dimensions: ["financial", "temporal"],
    severity: "HIGH",
    confidence: 0.8,
    description: "Test inconsistency description referencing real evidence IDs.",
    evidenceReferences: [],
    supportingChecks: [],
    observedValues: {},
    expectedRelationship: "Test relationship.",
    engineVersion: "cross-modal-v1",
    createdAt: "2025-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function inconsistencyResult(items: CrossModalInconsistency[] = []): CrossModalAnalysisResult {
  const countsBySeverity: Record<InconsistencySeverity, number> = { INFO: 0, LOW: 0, MODERATE: 0, HIGH: 0, CRITICAL: 0 };
  for (const item of items) countsBySeverity[item.severity] += 1;
  return { items, countsBySeverity, engineVersion: "cross-modal-v1", updatedAt: "2025-01-01T00:00:00.000Z" };
}

function input(overrides: Partial<VerificationPriorityInput> = {}): VerificationPriorityInput {
  return { fusion: fusionResult(), inconsistencies: inconsistencyResult(), ...overrides };
}

describe("evaluateVerificationPriority", () => {
  // 1. no anomalies / consistent evidence -> LOW
  test("1: consistent evidence with no inconsistencies produces LOW priority", () => {
    const result = evaluateVerificationPriority(input());
    assert.equal(result.priority, "LOW");
  });

  // 2. insufficient evidence -> low-confidence LOW result, not treated as an anomaly
  test("2: insufficient evidence produces LOW priority with low confidence and an explicit insufficient-evidence reason/recommendation", () => {
    const result = evaluateVerificationPriority(
      input({ fusion: fusionResult({ status: "INSUFFICIENT_EVIDENCE", overallEvidenceScore: null, overallConfidence: 0, lenses: [] }) }),
    );
    assert.equal(result.priority, "LOW");
    assert.equal(result.confidence, 0);
    assert.ok(result.why.some((w) => w.type === "INSUFFICIENT_EVIDENCE"));
    assert.match(result.recommendation, /insufficient/i);
    assert.match(result.primaryFinding, /insufficient/i);
  });

  // 3. moderate evidence signal -> MODERATE
  test("3: a moderate fusion score with meaningful coverage produces MODERATE priority", () => {
    const result = evaluateVerificationPriority(input({ fusion: fusionResult({ overallEvidenceScore: 0.3, coverage: fusionResult().coverage }) }));
    assert.equal(result.priority, "MODERATE");
  });

  // 4. high evidence signal -> HIGH
  test("4: a high fusion score with adequate confidence produces HIGH priority on its own", () => {
    const result = evaluateVerificationPriority(input({ fusion: fusionResult({ overallEvidenceScore: 0.6, overallConfidence: 0.7 }) }));
    assert.equal(result.priority, "HIGH");
  });

  // 5. one CRITICAL inconsistency -> CRITICAL, overriding an otherwise-low score
  test("5: a single CRITICAL inconsistency floors priority at CRITICAL even with a low fusion score", () => {
    const result = evaluateVerificationPriority(
      input({
        fusion: fusionResult({ overallEvidenceScore: 0.05 }),
        inconsistencies: inconsistencyResult([inconsistency({ severity: "CRITICAL" })]),
      }),
    );
    assert.equal(result.priority, "CRITICAL");
  });

  // 6. HIGH inconsistency escalation: one HIGH + elevated score -> HIGH
  test("6: a single HIGH inconsistency combined with an elevated fusion score escalates to HIGH", () => {
    const result = evaluateVerificationPriority(
      input({
        fusion: fusionResult({ overallEvidenceScore: 0.55, overallConfidence: 0.3 }), // confidence below adequate, so score-alone would NOT trigger HIGH
        inconsistencies: inconsistencyResult([inconsistency({ severity: "HIGH" })]),
      }),
    );
    assert.equal(result.priority, "HIGH");
  });

  // 7. multiple HIGH inconsistencies -> HIGH, even with a low fusion score
  test("7: two or more HIGH inconsistencies alone produce HIGH priority regardless of fusion score", () => {
    const result = evaluateVerificationPriority(
      input({
        fusion: fusionResult({ overallEvidenceScore: 0.05 }),
        inconsistencies: inconsistencyResult([inconsistency({ severity: "HIGH", id: "a" }), inconsistency({ severity: "HIGH", id: "b" })]),
      }),
    );
    assert.equal(result.priority, "HIGH");
  });

  // 8. LOW/MODERATE inconsistencies do not incorrectly create CRITICAL or HIGH
  test("8: LOW and MODERATE inconsistencies never escalate priority past MODERATE on their own", () => {
    const result = evaluateVerificationPriority(
      input({
        fusion: fusionResult({ overallEvidenceScore: 0.05 }),
        inconsistencies: inconsistencyResult([
          inconsistency({ severity: "LOW", id: "a" }),
          inconsistency({ severity: "LOW", id: "b" }),
          inconsistency({ severity: "MODERATE", id: "c" }),
        ]),
      }),
    );
    assert.equal(result.priority, "MODERATE");
    assert.notEqual(result.priority, "HIGH");
    assert.notEqual(result.priority, "CRITICAL");
  });

  // 9. confidence does not equal priority
  test("9a: HIGH priority can coexist with only moderate confidence", () => {
    const result = evaluateVerificationPriority(
      input({
        fusion: fusionResult({ overallEvidenceScore: 0.1, overallConfidence: 0.45 }),
        inconsistencies: inconsistencyResult([inconsistency({ severity: "HIGH", id: "a" }), inconsistency({ severity: "HIGH", id: "b" })]),
      }),
    );
    assert.equal(result.priority, "HIGH");
    assert.equal(result.confidence, 0.45);
    assert.notEqual(result.confidence, 1);
  });

  test("9b: LOW priority can coexist with high confidence (multiple streams agree it's clean)", () => {
    const result = evaluateVerificationPriority(input({ fusion: fusionResult({ overallEvidenceScore: 0.02, overallConfidence: 0.92 }) }));
    assert.equal(result.priority, "LOW");
    assert.equal(result.confidence, 0.92);
  });

  // 10 & 11: no dependency on project.priority or project id — the input
  // type structurally cannot carry either, so identical fusion/inconsistency
  // inputs always produce identical results regardless of what the caller's
  // (unrelated) project record says.
  test("10/11: the engine's input type carries only fusion and inconsistencies — no project.priority or project id field exists to influence it", () => {
    const sampleInput = input();
    assert.deepEqual(Object.keys(sampleInput).sort(), ["fusion", "inconsistencies"]);
    // Simulates two callers with different underlying project.priority /
    // project id values feeding the SAME evidence — the result must be
    // byte-identical because the engine never receives that information.
    const a = evaluateVerificationPriority(sampleInput);
    const b = evaluateVerificationPriority(sampleInput);
    assert.deepEqual(a, b);
  });

  // 12. deterministic output
  test("12: identical input produces identical output across repeated calls", () => {
    const sampleInput = input({ inconsistencies: inconsistencyResult([inconsistency({ severity: "HIGH" })]) });
    const a = evaluateVerificationPriority(sampleInput);
    const b = evaluateVerificationPriority(sampleInput);
    assert.deepEqual(a, b);
  });

  // 13. recommendation uses actual drivers
  test("13: the recommendation names the actual triggering inconsistency type, not generic language", () => {
    const result = evaluateVerificationPriority(
      input({ inconsistencies: inconsistencyResult([inconsistency({ severity: "HIGH", type: "geo_visual_reused_image_different_location" })]) }),
    );
    assert.match(result.recommendation, /reused imagery/i);
    assert.doesNotMatch(result.recommendation, /investigate fraud/i);
  });

  test("13b: with no inconsistencies but an anomalous lens, the recommendation names the actual anomalous dimension", () => {
    const result = evaluateVerificationPriority(
      input({ fusion: fusionResult({ overallEvidenceScore: 0.6, overallConfidence: 0.7, lenses: [normalizedLens("financial", true), normalizedLens("geospatial", false)] }) }),
    );
    assert.match(result.recommendation, /financial/i);
  });

  // 14. reasons only mention real evidence — never fabricated beyond the input
  test("14: every inconsistency description in reasons is verbatim from the actual input, never invented", () => {
    const critical = inconsistency({ severity: "CRITICAL", description: "A very specific, real description of what was found." });
    const result = evaluateVerificationPriority(input({ inconsistencies: inconsistencyResult([critical]) }));
    assert.ok(result.reasons.includes(critical.description));
  });

  // 15. no second competing risk score
  test("15: drivers.evidenceScore is an exact passthrough of fusion.overallEvidenceScore, never recomputed", () => {
    const fusion = fusionResult({ overallEvidenceScore: 0.37 });
    const result = evaluateVerificationPriority(input({ fusion }));
    assert.equal(result.drivers.evidenceScore, fusion.overallEvidenceScore);
    assert.equal(result.drivers.evidenceConfidence, fusion.overallConfidence);
  });

  // 16. existing P0-J/P0-K behavior remains unchanged + full pipeline integration
  test("16: the real fusion and cross-modal engines feed this engine correctly end-to-end", () => {
    const financial: FinancialAnalysisResult = {
      evidenceLevel: "DETAILED",
      status: "ANOMALY_DETECTED",
      score: 0.5,
      confidence: 0.9,
      sanction: 1000000,
      expenditure: 500000,
      paymentTotal: 500000,
      expenditureRatio: 0.5,
      peerGroup: { dimension: "category", size: 5, median: 0.5, mean: 0.5, standardDeviation: 0.1, mad: 0.05, percentileRank: 0.5 },
      checks: [{ name: "expenditure_before_sanction", severity: "HIGH", message: "x", supportingRecordIds: [1] }],
      reasons: ["x"],
      recordCount: 6,
      engineVersion: "financial-v1",
      updatedAt: "2025-01-01T00:00:00.000Z",
    };
    const temporal: TemporalAnalysisResult = {
      status: "TEMPORAL_ANOMALY",
      score: 0.5,
      confidence: 0.9,
      progressRecordCount: 4,
      financialRecordCount: 6,
      imageWithDateCount: 3,
      firstEventDate: "2024-01-01",
      lastEventDate: "2024-06-01",
      firstProgressDate: "2024-01-15",
      lastProgressDate: "2024-05-30",
      progressReportCount: 4,
      elapsedDays: 150,
      progressChange: 80,
      progressRatePerDay: 0.53,
      checks: [{ name: "financial_before_sanction", severity: "HIGH", message: "x", supportingRecordIds: [1] }],
      reasons: ["x"],
      engineVersion: "temporal-v1",
      updatedAt: "2025-01-01T00:00:00.000Z",
    };
    const geo: GeoAnalysisResult = {
      status: "LOCATION_CONSISTENT",
      score: 0.05,
      confidence: 0.8,
      declaredLatitude: 26.45,
      declaredLongitude: 80.33,
      imageCount: 0,
      validGpsCount: 0,
      invalidGpsCount: 0,
      missingGpsCount: 0,
      minDistanceMeters: null,
      maxDistanceMeters: null,
      medianDistanceMeters: null,
      points: [],
      checks: [],
      reasons: [],
      engineVersion: "geo-v1",
      updatedAt: "2025-01-01T00:00:00.000Z",
    };
    const text: TextAnalysisResult = {
      status: "CONSISTENT",
      score: 0.05,
      confidence: 0.8,
      descriptionLength: 100,
      tokenCount: 20,
      categoryKeywordsAvailable: true,
      categoryMatchCount: 3,
      peerGroup: { dimension: "category", size: 3, topMatches: [], averageSimilarity: 0.2 },
      checks: [],
      reasons: [],
      method: "token-overlap",
      engineVersion: "text-v1",
      updatedAt: "2025-01-01T00:00:00.000Z",
    };
    const visual: VisualAnalysisResult = {
      status: "CONSISTENT",
      score: 0.05,
      confidence: 0.8,
      imageCount: 2,
      datedImageCount: 2,
      undatedImageCount: 0,
      earliestCapturedAt: "2024-01-01T00:00:00.000Z",
      latestCapturedAt: "2024-02-01T00:00:00.000Z",
      checks: [],
      reasons: [],
      engineVersion: "visual-v1",
      updatedAt: "2025-01-01T00:00:00.000Z",
    };
    const rawFinancialRecords = [
      { id: 1, type: "EXPENDITURE", amount: 100000, recordedDate: "2023-12-01" },
      { id: 2, type: "SANCTION", amount: 1000000, recordedDate: "2024-01-01" },
    ];
    const inconsistencies = evaluateCrossModalInconsistencies({
      project: { id: "P-TEST", category: "Road", description: "x", latitude: 26.45, longitude: 80.33, startDate: "2024-01-01", expectedCompletion: "2024-06-01", actualCompletion: null },
      financial,
      geospatial: geo,
      temporal,
      text,
      visual,
      rawFinancialRecords,
      rawProgressRecords: [],
      rawEvidenceImages: [],
    });
    const fusion = evaluateEvidenceFusion({ financial, geospatial: geo, temporal, text, visual }, DEFAULT_LENS_WEIGHTS, inconsistencies.items);
    const result = evaluateVerificationPriority({ fusion, inconsistencies });
    // The correlated financial/temporal fact correctly produces exactly ONE
    // inconsistency (P0-K's own dedup, unchanged) rather than two. With only
    // that single HIGH inconsistency and a fused evidence score that is
    // elevated but not "strong" (~0.27, short of the 0.5 HIGH-alone bar),
    // the documented policy correctly stops at MODERATE — a single HIGH
    // finding is not, by itself, enough to reach HIGH without either a
    // second HIGH finding or a strong (>=0.5) fusion score. This proves the
    // policy is not naively "any HIGH inconsistency escalates."
    assert.equal(inconsistencies.items.length, 1);
    assert.ok(fusion.overallEvidenceScore !== null && fusion.overallEvidenceScore < 0.5);
    assert.equal(result.priority, "MODERATE");
    assert.match(result.recommendation, /sanction/i);
  });

  // Explicit regression: same fusion + same inconsistencies + (simulated)
  // different project.priority => identical computed verification priority.
  test("regression: identical evidence produces an identical result regardless of any surrounding project.priority value", () => {
    const sharedFusion = fusionResult({ overallEvidenceScore: 0.4, overallConfidence: 0.6 });
    const sharedInconsistencies = inconsistencyResult([inconsistency({ severity: "MODERATE" })]);
    // project.priority is not a parameter at all -- calling with the exact
    // same evidence twice, as if from two callers whose underlying project
    // rows disagree on project.priority ("LOW" vs "CRITICAL"), must be
    // indistinguishable to this engine.
    const resultAsIfProjectPriorityWereLow = evaluateVerificationPriority({ fusion: sharedFusion, inconsistencies: sharedInconsistencies });
    const resultAsIfProjectPriorityWereCritical = evaluateVerificationPriority({ fusion: sharedFusion, inconsistencies: sharedInconsistencies });
    assert.deepEqual(resultAsIfProjectPriorityWereLow, resultAsIfProjectPriorityWereCritical);
  });

  // Explicit regression: same evidence + different project IDs => identical result.
  test("regression: identical evidence produces an identical result regardless of project id", () => {
    const sharedFusion = fusionResult({ overallEvidenceScore: 0.4, overallConfidence: 0.6 });
    const sharedInconsistencies = inconsistencyResult([inconsistency({ severity: "MODERATE" })]);
    const resultForProjectA = evaluateVerificationPriority({ fusion: sharedFusion, inconsistencies: sharedInconsistencies });
    const resultForProjectB = evaluateVerificationPriority({ fusion: sharedFusion, inconsistencies: sharedInconsistencies });
    assert.deepEqual(resultForProjectA, resultForProjectB);
  });

  // ---------------------------------------------------------------------------
  // P0-M: structured why-trail + primaryFinding
  // ---------------------------------------------------------------------------

  describe("P0-M: structured why-trail and primaryFinding", () => {
    // 1 & 4. CRITICAL inconsistency appears in the why trail
    test("a CRITICAL inconsistency appears as a CROSS_MODAL why-entry carrying its own evidence references", () => {
      const critical = inconsistency({ severity: "CRITICAL", description: "A very specific finding.", evidenceReferences: [{ type: "financial_record", id: 1, label: "EXPENDITURE record", value: "x" }] });
      const result = evaluateVerificationPriority(input({ inconsistencies: inconsistencyResult([critical]) }));
      const entry = result.why.find((w) => w.type === "CROSS_MODAL" && w.explanation === critical.description);
      assert.ok(entry);
      assert.equal(entry?.severity, "CRITICAL");
      assert.deepEqual(entry?.evidenceReferences, critical.evidenceReferences);
    });

    // 3. HIGH priority produces an evidence-backed explanation (not just a number)
    test("HIGH priority from a strong fusion signal explains WHICH lens contributed, not just the raw score", () => {
      const result = evaluateVerificationPriority(
        input({
          fusion: fusionResult({
            overallEvidenceScore: 0.6,
            overallConfidence: 0.7,
            lenses: [normalizedLens("financial", true, { checks: [{ name: "expenditure_exceeds_sanction", severity: "HIGH", message: "Expenditure exceeds the sanctioned amount by 40%." }] })],
          }),
        }),
      );
      const fusionEntry = result.why.find((w) => w.type === "FUSION" && w.title === "Financial evidence is anomalous");
      assert.ok(fusionEntry);
      assert.match(fusionEntry!.explanation, /exceeds the sanctioned amount/);
      assert.doesNotMatch(fusionEntry!.explanation, /score = /i);
    });

    // 5. insufficient evidence produces a distinct why-entry type and a collection recommendation
    test("insufficient evidence produces an INSUFFICIENT_EVIDENCE why-entry and a collection recommendation, never 'no fraud detected'", () => {
      const result = evaluateVerificationPriority(input({ fusion: fusionResult({ status: "INSUFFICIENT_EVIDENCE", overallEvidenceScore: null, overallConfidence: 0, lenses: [] }) }));
      assert.ok(result.why.some((w) => w.type === "INSUFFICIENT_EVIDENCE"));
      assert.doesNotMatch(result.recommendation, /no fraud/i);
      assert.doesNotMatch(result.primaryFinding, /no fraud/i);
    });

    // 2. no fabricated finding when no issue exists
    test("primaryFinding is an honest 'no material inconsistency' statement when evidence is consistent, never a fabricated finding", () => {
      const result = evaluateVerificationPriority(input());
      assert.match(result.primaryFinding, /no material inconsistency/i);
    });

    // primaryFinding uses the most severe real inconsistency when one exists
    test("primaryFinding is the actual most-severe inconsistency's description, verbatim, when one exists", () => {
      const critical = inconsistency({ severity: "CRITICAL", description: "The single most severe real finding." });
      const result = evaluateVerificationPriority(input({ inconsistencies: inconsistencyResult([inconsistency({ severity: "LOW" }), critical]) }));
      assert.equal(result.primaryFinding, critical.description);
    });

    // 6/7/8/9/10/11: every why-entry traces to real evidence, never fabricated
    test("every CROSS_MODAL why-entry's explanation is verbatim from a real input inconsistency, and every FUSION why-entry cites a real triggered check", () => {
      const inc = inconsistency({ severity: "HIGH", description: "Real, specific description with an amount and a date." });
      const result = evaluateVerificationPriority(
        input({
          fusion: fusionResult({ overallEvidenceScore: 0.55, overallConfidence: 0.6, lenses: [normalizedLens("geospatial", true, { checks: [{ name: "location_anomaly", severity: "HIGH", message: "Evidence GPS is 2.1 km from the declared project location." }] })] }),
          inconsistencies: inconsistencyResult([inc]),
        }),
      );
      const crossModalEntries = result.why.filter((w) => w.type === "CROSS_MODAL" && w.explanation === inc.description);
      assert.ok(crossModalEntries.length > 0);
      const fusionEntries = result.why.filter((w) => w.type === "FUSION" && w.explanation.includes("2.1 km"));
      assert.ok(fusionEntries.length > 0);
      assert.deepEqual(fusionEntries[0].supportingChecks, [{ lens: "geospatial", checkName: "location_anomaly" }]);
    });

    // 12/13: deterministic, and project id/priority-agnostic (the why-trail specifically)
    test("the why-trail and primaryFinding are deterministic and identical across repeated calls with identical evidence", () => {
      const sampleInput = input({
        fusion: fusionResult({ overallEvidenceScore: 0.6, overallConfidence: 0.7 }),
        inconsistencies: inconsistencyResult([inconsistency({ severity: "HIGH" }), inconsistency({ severity: "HIGH", id: "b" })]),
      });
      const a = evaluateVerificationPriority(sampleInput);
      const b = evaluateVerificationPriority(sampleInput);
      assert.deepEqual(a.why, b.why);
      assert.equal(a.primaryFinding, b.primaryFinding);
    });

    // 14: no hardcoded project-specific narrative -- why-trail/primaryFinding never reference a project id or name
    test("no why-entry or primaryFinding ever mentions a project id, since none is ever passed to this engine", () => {
      const result = evaluateVerificationPriority(
        input({
          fusion: fusionResult({ overallEvidenceScore: 0.6, overallConfidence: 0.7 }),
          inconsistencies: inconsistencyResult([inconsistency({ severity: "HIGH" })]),
        }),
      );
      const allText = [result.primaryFinding, result.recommendation, ...result.why.map((w) => `${w.title} ${w.explanation}`)].join(" ");
      assert.doesNotMatch(allText, /P-\d{4}/);
    });

    // reasons stays exactly derived from why -- no orphaned strings
    test("reasons is exactly why.map(explanation) -- no reason string exists outside the why-trail", () => {
      const result = evaluateVerificationPriority(
        input({ fusion: fusionResult({ overallEvidenceScore: 0.6, overallConfidence: 0.7 }), inconsistencies: inconsistencyResult([inconsistency({ severity: "HIGH" }), inconsistency({ severity: "HIGH", id: "b" })]) }),
      );
      assert.deepEqual(result.reasons, result.why.map((w) => w.explanation));
    });
  });
});
