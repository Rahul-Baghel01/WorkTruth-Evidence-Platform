import "./test-env";
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { evaluateEvidenceFusion, DEFAULT_LENS_WEIGHTS, type LensResults } from "./fusion-engine";
import type { CrossModalInconsistency } from "./cross-modal-engine";
import type { FinancialAnalysisResult } from "./financial-engine";
import type { GeoAnalysisResult } from "./geo-engine";
import type { TemporalAnalysisResult } from "./temporal-engine";
import type { TextAnalysisResult } from "./text-engine";
import type { VisualAnalysisResult } from "./visual-engine";

// ---------------------------------------------------------------------------
// Fixture builders — each produces a minimal, real-shaped engine result.
// These are NOT calls into the real compute*Analysis DB wrappers: the fusion
// engine is a pure function of the five engines' *outputs*, so pure fixtures
// are the correct level to test it at.
// ---------------------------------------------------------------------------

function financial(overrides: Partial<FinancialAnalysisResult> = {}): FinancialAnalysisResult {
  return {
    evidenceLevel: "DETAILED",
    status: "WITHIN_EXPECTED_RANGE",
    score: 0.05,
    confidence: 0.8,
    sanction: 1000000,
    expenditure: 500000,
    paymentTotal: 500000,
    expenditureRatio: 0.5,
    peerGroup: { dimension: "category", size: 5, median: 0.5, mean: 0.5, standardDeviation: 0.1, mad: 0.05, percentileRank: 0.5 },
    checks: [{ name: "expenditure_ratio_normal", severity: "INFO", message: "Expenditure ratio is within the expected range." }],
    reasons: ["Expenditure ratio is within the expected range."],
    recordCount: 6,
    engineVersion: "financial-v1",
    updatedAt: "2025-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function geospatial(overrides: Partial<GeoAnalysisResult> = {}): GeoAnalysisResult {
  return {
    status: "LOCATION_CONSISTENT",
    score: 0.05,
    confidence: 0.8,
    declaredLatitude: 28.6,
    declaredLongitude: 77.2,
    imageCount: 3,
    validGpsCount: 3,
    invalidGpsCount: 0,
    missingGpsCount: 0,
    minDistanceMeters: 10,
    maxDistanceMeters: 50,
    medianDistanceMeters: 20,
    points: [],
    checks: [{ name: "gps_within_expected_radius", severity: "INFO", message: "All image GPS points are close to the declared location." }],
    reasons: ["All image GPS points are close to the declared location."],
    engineVersion: "geo-v1",
    updatedAt: "2025-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function temporal(overrides: Partial<TemporalAnalysisResult> = {}): TemporalAnalysisResult {
  return {
    status: "TEMPORALLY_CONSISTENT",
    score: 0.05,
    confidence: 0.8,
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
    checks: [{ name: "chronology_consistent", severity: "INFO", message: "All recorded events follow a consistent chronology." }],
    reasons: ["All recorded events follow a consistent chronology."],
    engineVersion: "temporal-v1",
    updatedAt: "2025-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function text(overrides: Partial<TextAnalysisResult> = {}): TextAnalysisResult {
  return {
    status: "CONSISTENT",
    score: 0.05,
    confidence: 0.8,
    descriptionLength: 240,
    tokenCount: 40,
    categoryKeywordsAvailable: true,
    categoryMatchCount: 5,
    peerGroup: { dimension: "category", size: 5, topMatches: [], averageSimilarity: 0.2 },
    checks: [{ name: "category_keywords_present", severity: "INFO", message: "Description contains expected category keywords." }],
    reasons: ["Description contains expected category keywords."],
    method: "token-overlap",
    engineVersion: "text-v1",
    updatedAt: "2025-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function visual(overrides: Partial<VisualAnalysisResult> = {}): VisualAnalysisResult {
  return {
    status: "CONSISTENT",
    score: 0.05,
    confidence: 0.8,
    imageCount: 4,
    datedImageCount: 4,
    undatedImageCount: 0,
    earliestCapturedAt: "2024-01-01T00:00:00.000Z",
    latestCapturedAt: "2024-06-01T00:00:00.000Z",
    checks: [{ name: "no_duplicate_images", severity: "INFO", message: "No duplicate or near-duplicate images detected." }],
    reasons: ["No duplicate or near-duplicate images detected."],
    engineVersion: "visual-v1",
    updatedAt: "2025-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function allNormal(): LensResults {
  return { financial: financial(), geospatial: geospatial(), temporal: temporal(), text: text(), visual: visual() };
}

const INSUFFICIENT_FINANCIAL: FinancialAnalysisResult = financial({
  evidenceLevel: "NONE",
  status: "INSUFFICIENT_EVIDENCE",
  score: null,
  confidence: 0,
  sanction: null,
  expenditure: null,
  paymentTotal: null,
  expenditureRatio: null,
  checks: [],
  reasons: ["No financial records are available for this project."],
  recordCount: 0,
});

const INSUFFICIENT_GEO: GeoAnalysisResult = geospatial({
  status: "INSUFFICIENT_EVIDENCE",
  score: null,
  confidence: 0,
  imageCount: 0,
  validGpsCount: 0,
  minDistanceMeters: null,
  maxDistanceMeters: null,
  medianDistanceMeters: null,
  checks: [],
  reasons: ["No georeferenced evidence images are available for this project."],
});

const INSUFFICIENT_TEMPORAL: TemporalAnalysisResult = temporal({
  status: "INSUFFICIENT_EVIDENCE",
  score: null,
  confidence: 0,
  progressRecordCount: 0,
  financialRecordCount: 0,
  imageWithDateCount: 0,
  firstEventDate: null,
  lastEventDate: null,
  firstProgressDate: null,
  lastProgressDate: null,
  progressReportCount: 0,
  elapsedDays: null,
  progressChange: null,
  progressRatePerDay: null,
  checks: [],
  reasons: ["Not enough dated events are available to assess chronology."],
});

const INSUFFICIENT_TEXT: TextAnalysisResult = text({
  status: "INSUFFICIENT_EVIDENCE",
  score: null,
  confidence: 0,
  descriptionLength: 0,
  tokenCount: 0,
  categoryKeywordsAvailable: false,
  categoryMatchCount: 0,
  checks: [],
  reasons: ["No project description is available."],
});

const INSUFFICIENT_VISUAL: VisualAnalysisResult = visual({
  status: "INSUFFICIENT_EVIDENCE",
  score: null,
  confidence: 0,
  imageCount: 0,
  datedImageCount: 0,
  undatedImageCount: 0,
  earliestCapturedAt: null,
  latestCapturedAt: null,
  checks: [],
  reasons: ["No evidence images have been uploaded for this project."],
});

describe("evaluateEvidenceFusion", () => {
  // A. all five lenses normal -> low anomaly, high confidence, STRONG_EVIDENCE
  test("A: all lenses normal produces a low overall score and STRONG_EVIDENCE status", () => {
    const result = evaluateEvidenceFusion(allNormal());
    assert.equal(result.status, "STRONG_EVIDENCE");
    assert.ok(result.overallEvidenceScore !== null && result.overallEvidenceScore < 0.2);
    assert.equal(result.coverage.availableLensCount, 5);
    assert.equal(result.mixedEvidence.isMixed, false);
  });

  // B. one high-confidence anomaly among otherwise-normal lenses
  test("B: a single high-confidence anomalous lens raises the score and is reported as mixed evidence", () => {
    const lenses = allNormal();
    lenses.financial = financial({
      status: "ANOMALY_DETECTED",
      score: 0.6,
      confidence: 0.9,
      checks: [{ name: "expenditure_exceeds_sanction", severity: "HIGH", message: "Expenditure exceeds the sanctioned amount." }],
      reasons: ["Expenditure exceeds the sanctioned amount."],
    });
    const result = evaluateEvidenceFusion(lenses);
    assert.ok(result.overallEvidenceScore !== null && result.overallEvidenceScore > 0);
    assert.equal(result.mixedEvidence.isMixed, true);
    assert.deepEqual(result.mixedEvidence.anomalousLenses, ["financial"]);
  });

  // C. multiple independent high-confidence anomalies -> agreement bonus applied
  test("C: multiple independent anomalous lenses trigger a cross-lens agreement bonus", () => {
    const lenses = allNormal();
    lenses.financial = financial({
      status: "ANOMALY_DETECTED",
      score: 0.5,
      confidence: 0.9,
      checks: [{ name: "expenditure_exceeds_sanction", severity: "HIGH", message: "Expenditure exceeds sanction." }],
      reasons: ["Expenditure exceeds sanction."],
    });
    lenses.visual = visual({
      status: "REQUIRES_VERIFICATION",
      score: 0.5,
      confidence: 0.9,
      checks: [{ name: "duplicate_image_detected", severity: "HIGH", message: "Duplicate images detected across progress stages." }],
      reasons: ["Duplicate images detected across progress stages."],
    });
    const withAgreement = evaluateEvidenceFusion(lenses);
    assert.equal(withAgreement.agreement.agreeingLensCount, 2);
    assert.ok(withAgreement.agreement.bonus > 0);

    // Without agreement (only financial anomalous), the score should be lower.
    const soloLenses = allNormal();
    soloLenses.financial = lenses.financial;
    const solo = evaluateEvidenceFusion(soloLenses);
    assert.ok(withAgreement.overallEvidenceScore! > solo.overallEvidenceScore!);
  });

  // D. high anomaly score but low confidence -> contribution damped
  test("D: a low-confidence anomalous lens contributes less than an equally anomalous high-confidence lens", () => {
    const highConfidence = allNormal();
    highConfidence.financial = financial({ status: "ANOMALY_DETECTED", score: 0.6, confidence: 0.9, checks: [{ name: "x", severity: "HIGH", message: "x" }] });
    const lowConfidence = allNormal();
    lowConfidence.financial = financial({ status: "ANOMALY_DETECTED", score: 0.6, confidence: 0.15, checks: [{ name: "x", severity: "HIGH", message: "x" }] });

    const highResult = evaluateEvidenceFusion(highConfidence);
    const lowResult = evaluateEvidenceFusion(lowConfidence);
    assert.ok(lowResult.overallEvidenceScore! < highResult.overallEvidenceScore!);
  });

  // E. missing one lens -> renormalized weights, coverage reflects 4/5
  test("E: one missing lens is excluded from scoring, not treated as zero risk, and reflected in coverage", () => {
    const lenses = allNormal();
    lenses.text = INSUFFICIENT_TEXT;
    const result = evaluateEvidenceFusion(lenses);
    assert.equal(result.coverage.availableLensCount, 4);
    assert.deepEqual(result.coverage.unavailableLenses, ["text"]);
    assert.ok(result.overallEvidenceScore !== null);
    // Score should still be low (all remaining lenses are normal), not pushed toward 1 or 0 artificially.
    assert.ok(result.overallEvidenceScore! < 0.2);
  });

  // F. missing multiple lenses -> coverage drops further, status downgrades
  test("F: missing multiple lenses reduces coverage and evidence-sufficiency status", () => {
    const lenses = allNormal();
    lenses.text = INSUFFICIENT_TEXT;
    lenses.visual = INSUFFICIENT_VISUAL;
    lenses.geospatial = INSUFFICIENT_GEO;
    const result = evaluateEvidenceFusion(lenses);
    assert.equal(result.coverage.availableLensCount, 2);
    assert.notEqual(result.status, "STRONG_EVIDENCE");
    assert.ok(result.overallEvidenceScore !== null);
  });

  // G. all lenses insufficient -> explicit INSUFFICIENT_EVIDENCE, null score
  test("G: all five lenses insufficient produces INSUFFICIENT_EVIDENCE with a null score, not zero", () => {
    const result = evaluateEvidenceFusion({
      financial: INSUFFICIENT_FINANCIAL,
      geospatial: INSUFFICIENT_GEO,
      temporal: INSUFFICIENT_TEMPORAL,
      text: INSUFFICIENT_TEXT,
      visual: INSUFFICIENT_VISUAL,
    });
    assert.equal(result.status, "INSUFFICIENT_EVIDENCE");
    assert.equal(result.overallEvidenceScore, null);
    assert.equal(result.overallConfidence, 0);
    assert.equal(result.coverage.availableLensCount, 0);
  });

  // H. strong cross-lens agreement across 3+ independent lenses
  test("H: three independent anomalous lenses produce a larger agreement bonus than two", () => {
    const twoLenses = allNormal();
    twoLenses.financial = financial({ status: "ANOMALY_DETECTED", score: 0.4, confidence: 0.8, checks: [{ name: "a", severity: "MODERATE", message: "a" }] });
    twoLenses.visual = visual({ status: "REQUIRES_VERIFICATION", score: 0.4, confidence: 0.8, checks: [{ name: "b", severity: "MODERATE", message: "b" }] });
    const two = evaluateEvidenceFusion(twoLenses);

    const threeLenses = allNormal();
    threeLenses.financial = twoLenses.financial;
    threeLenses.visual = twoLenses.visual;
    threeLenses.geospatial = geospatial({ status: "LOCATION_ANOMALY", score: 0.4, confidence: 0.8, checks: [{ name: "c", severity: "MODERATE", message: "c" }] });
    const three = evaluateEvidenceFusion(threeLenses);

    assert.ok(three.agreement.bonus > two.agreement.bonus);
    assert.equal(three.agreement.agreeingLensCount, 3);
  });

  // I. mixed / contradictory evidence -> reported, not silently averaged away
  test("I: mixed evidence (some lenses anomalous, others consistent) is flagged and reduces confidence", () => {
    const lenses = allNormal();
    lenses.financial = financial({ status: "ANOMALY_DETECTED", score: 0.6, confidence: 0.9, checks: [{ name: "x", severity: "HIGH", message: "x" }] });
    const mixed = evaluateEvidenceFusion(lenses);
    const clean = evaluateEvidenceFusion(allNormal());
    assert.equal(mixed.mixedEvidence.isMixed, true);
    assert.ok(mixed.mixedEvidence.explanation.length > 0);
    assert.ok(mixed.overallConfidence < clean.overallConfidence);
  });

  // J. determinism -- same input, same output (modulo updatedAt timestamp)
  test("J: identical input produces identical scoring output across repeated calls", () => {
    const lenses = allNormal();
    const a = evaluateEvidenceFusion(lenses);
    const b = evaluateEvidenceFusion(lenses);
    assert.equal(a.overallEvidenceScore, b.overallEvidenceScore);
    assert.equal(a.overallConfidence, b.overallConfidence);
    assert.equal(a.status, b.status);
    assert.deepEqual(a.coverage, b.coverage);
    assert.deepEqual(a.agreement.bonus, b.agreement.bonus);
  });

  // K. no project-ID-specific behavior -- the fusion engine never sees a project id at all
  test("K: evaluateEvidenceFusion accepts no project identifier and behaves identically for differently-shaped inputs with the same evidence", () => {
    const resultA = evaluateEvidenceFusion(allNormal());
    const resultB = evaluateEvidenceFusion(allNormal());
    assert.equal(resultA.overallEvidenceScore, resultB.overallEvidenceScore);
    // Structural guarantee: LensResults carries no id/name field the engine could branch on.
    const lensResultKeys = Object.keys(allNormal());
    assert.deepEqual(lensResultKeys.sort(), ["financial", "geospatial", "temporal", "text", "visual"]);
  });

  // L. weight normalization -- effective weights of available lenses always sum to ~1
  test("L: when lenses are missing, remaining weights are renormalized rather than left partial", () => {
    const lenses = allNormal();
    lenses.text = INSUFFICIENT_TEXT;
    lenses.visual = INSUFFICIENT_VISUAL;
    const result = evaluateEvidenceFusion(lenses);
    // With financial/geospatial/temporal all present and normal (low score), the
    // fused score should still land close to those lenses' own scores, not be
    // silently deflated by the unclaimed weight of the missing lenses.
    assert.ok(result.overallEvidenceScore !== null);
    assert.ok(result.overallEvidenceScore! < 0.15);
  });

  // M. confidence-adjusted contribution -- a lens with 0 confidence contributes ~0 weight
  test("M: a lens present but with near-zero confidence contributes negligibly to the score", () => {
    const lenses = allNormal();
    lenses.financial = financial({ status: "ANOMALY_DETECTED", score: 0.9, confidence: 0.01, checks: [{ name: "x", severity: "HIGH", message: "x" }] });
    const result = evaluateEvidenceFusion(lenses);
    // Even with a very high anomaly score, a near-zero confidence should keep the
    // overall score far below what an unweighted average (0.9 * 0.25 = 0.225) would give.
    assert.ok(result.overallEvidenceScore! < 0.1);
  });

  // N. evidence coverage calculation
  test("N: coverage reports exact counts, percentages, and lens name lists", () => {
    const lenses = allNormal();
    lenses.text = INSUFFICIENT_TEXT;
    const result = evaluateEvidenceFusion(lenses);
    assert.equal(result.coverage.availableLensCount, 4);
    assert.equal(result.coverage.totalLensCount, 5);
    assert.equal(result.coverage.coveragePercent, 0.8);
    assert.ok(result.coverage.effectiveWeightCoverage < 1);
    assert.ok(result.coverage.confidenceAdjustedCoverage > 0 && result.coverage.confidenceAdjustedCoverage <= 1);
    assert.deepEqual(result.coverage.availableLenses.sort(), ["financial", "geospatial", "temporal", "visual"]);
    assert.deepEqual(result.coverage.unavailableLenses, ["text"]);
  });

  // O. no double counting of correlated signals
  test("O: financial expenditure_before_sanction and temporal financial_before_sanction count as one agreement signal, not two", () => {
    const correlatedLenses = allNormal();
    correlatedLenses.financial = financial({
      status: "ANOMALY_DETECTED",
      score: 0.5,
      confidence: 0.9,
      checks: [{ name: "expenditure_before_sanction", severity: "HIGH", message: "Expenditure recorded before the project was sanctioned." }],
      reasons: ["Expenditure recorded before the project was sanctioned."],
    });
    correlatedLenses.temporal = temporal({
      status: "TEMPORAL_ANOMALY",
      score: 0.5,
      confidence: 0.9,
      checks: [{ name: "financial_before_sanction", severity: "HIGH", message: "Financial record dated before the sanction date." }],
      reasons: ["Financial record dated before the sanction date."],
    });
    const correlated = evaluateEvidenceFusion(correlatedLenses);
    // Both anomalies stem from the SAME underlying fact (financial and temporal
    // each independently detected it from the same source rows), so this must be
    // counted as ONE agreeing signal, not two -- and since a bonus requires >=2
    // *independent* agreeing lenses, no agreement bonus is awarded here.
    assert.equal(correlated.agreement.agreeingLensCount, 1);
    assert.equal(correlated.agreement.bonus, 0);
    assert.ok(
      correlated.agreement.signals.some(
        (s) => s.lenses.includes("financial") && s.lenses.includes("temporal") && s.description.includes("counted once, not twice"),
      ),
    );

    // Contrast: two independent (uncorrelated) anomalous checks DO count as agreement.
    const independentLenses = allNormal();
    independentLenses.financial = financial({
      status: "ANOMALY_DETECTED",
      score: 0.5,
      confidence: 0.9,
      checks: [{ name: "expenditure_exceeds_sanction", severity: "HIGH", message: "Expenditure exceeds sanction." }],
    });
    independentLenses.temporal = temporal({
      status: "TEMPORAL_ANOMALY",
      score: 0.5,
      confidence: 0.9,
      checks: [{ name: "progress_decreased", severity: "HIGH", message: "Progress percentage decreased between reports." }],
    });
    const independent = evaluateEvidenceFusion(independentLenses);
    assert.equal(independent.agreement.agreeingLensCount, 2);
    assert.ok(independent.agreement.bonus > 0);
    assert.ok(independent.overallEvidenceScore! > correlated.overallEvidenceScore!);
  });

  test("default weights sum to 1.0", () => {
    const sum = Object.values(DEFAULT_LENS_WEIGHTS).reduce((a, b) => a + b, 0);
    assert.ok(Math.abs(sum - 1.0) < 1e-9);
  });

  // P0-K integration: cross-modal inconsistencies are surfaced but never
  // change the score/confidence math (they are an optional 3rd argument).
  describe("P0-K integration: cross-modal inconsistency summary", () => {
    const sampleInconsistency: CrossModalInconsistency = {
      id: "financial_temporal_activity_before_sanction:1",
      type: "financial_temporal_activity_before_sanction",
      dimensions: ["financial", "temporal"],
      severity: "HIGH",
      confidence: 0.85,
      description: "A payment of ₹1,00,000 was recorded before the earliest sanction date.",
      evidenceReferences: [{ type: "financial_record", id: 1, label: "EXPENDITURE record", value: "₹1,00,000 on 2023-12-01" }],
      supportingChecks: [
        { lens: "financial", checkName: "expenditure_before_sanction" },
        { lens: "temporal", checkName: "financial_before_sanction" },
      ],
      observedValues: { earlyRecordCount: 1 },
      expectedRelationship: "Expenditure should be dated on or after sanction.",
      engineVersion: "cross-modal-v1",
      createdAt: "2025-01-01T00:00:00.000Z",
    };

    test("omitting the 3rd argument behaves exactly as P0-J did — crossModalSummary is present but empty", () => {
      const result = evaluateEvidenceFusion(allNormal());
      assert.equal(result.crossModalSummary.count, 0);
      assert.deepEqual(result.crossModalSummary.topInconsistencies, []);
    });

    test("a HIGH-severity inconsistency is surfaced in reasons and crossModalSummary without changing the score", () => {
      const withoutInconsistencies = evaluateEvidenceFusion(allNormal());
      const withInconsistencies = evaluateEvidenceFusion(allNormal(), DEFAULT_LENS_WEIGHTS, [sampleInconsistency]);
      // Score/confidence/status must be byte-identical — inconsistencies are
      // informational only, never a second scoring input (would double-count
      // against the lens scores that likely already reflect the same fact).
      assert.equal(withInconsistencies.overallEvidenceScore, withoutInconsistencies.overallEvidenceScore);
      assert.equal(withInconsistencies.overallConfidence, withoutInconsistencies.overallConfidence);
      assert.equal(withInconsistencies.status, withoutInconsistencies.status);
      assert.equal(withInconsistencies.crossModalSummary.count, 1);
      assert.equal(withInconsistencies.crossModalSummary.countsBySeverity.HIGH, 1);
      assert.ok(withInconsistencies.reasons.some((r) => r.startsWith("Cross-evidence:")));
    });

    test("a LOW-severity inconsistency is counted but not folded into the reasons narrative (only HIGH/CRITICAL are)", () => {
      const low: CrossModalInconsistency = { ...sampleInconsistency, id: "text_category_mismatch:P-1", type: "text_category_mismatch", severity: "LOW", dimensions: ["text", "category"] };
      const result = evaluateEvidenceFusion(allNormal(), DEFAULT_LENS_WEIGHTS, [low]);
      assert.equal(result.crossModalSummary.count, 1);
      assert.equal(result.crossModalSummary.countsBySeverity.LOW, 1);
      assert.ok(!result.reasons.some((r) => r.startsWith("Cross-evidence:")));
    });

    test("crossModalSummary is present even in the all-insufficient-evidence branch", () => {
      const result = evaluateEvidenceFusion(
        {
          financial: financial({ status: "INSUFFICIENT_EVIDENCE", score: null, confidence: 0 }),
          geospatial: geospatial({ status: "INSUFFICIENT_EVIDENCE", score: null, confidence: 0 }),
          temporal: temporal({ status: "INSUFFICIENT_EVIDENCE", score: null, confidence: 0 }),
          text: text({ status: "INSUFFICIENT_EVIDENCE", score: null, confidence: 0 }),
          visual: visual({ status: "INSUFFICIENT_EVIDENCE", score: null, confidence: 0 }),
        },
        DEFAULT_LENS_WEIGHTS,
        [sampleInconsistency],
      );
      assert.equal(result.status, "INSUFFICIENT_EVIDENCE");
      assert.equal(result.crossModalSummary.count, 1);
    });
  });

  // ---------------------------------------------------------------------------
  // Per-lens effectiveWeight: the exact confidence-adjusted, renormalized
  // weight each lens's score is multiplied by to form overallEvidenceScore.
  // Regression guard for the P-1562 "Geographic = 59% vs 3%" bug, where a
  // downstream consumer approximated a lens's contribution from the raw
  // configured weight (and a stale re-scale then multiplied it by 100).
  // ---------------------------------------------------------------------------
  describe("effectiveWeight", () => {
    test("available lenses' effectiveWeights sum to 1; unavailable lenses are 0", () => {
      const lenses = allNormal();
      lenses.text = INSUFFICIENT_TEXT;
      const result = evaluateEvidenceFusion(lenses);
      const sum = result.lenses.filter((l) => !l.isInsufficientEvidence).reduce((s, l) => s + l.effectiveWeight, 0);
      assert.ok(Math.abs(sum - 1) < 1e-9, `expected ~1, got ${sum}`);
      assert.equal(result.lenses.find((l) => l.lens === "text")!.effectiveWeight, 0);
    });

    test("score * effectiveWeight summed over available lenses reconciles with the base (pre-agreement-bonus) score", () => {
      const lenses = allNormal();
      lenses.financial = financial({ status: "ANOMALY_DETECTED", score: 0.6, confidence: 0.9, checks: [{ name: "x", severity: "HIGH", message: "x" }] });
      const result = evaluateEvidenceFusion(lenses);
      const reconstructed = result.lenses.reduce((s, l) => s + (l.score ?? 0) * l.effectiveWeight, 0);
      // No cross-lens agreement here (only one anomalous lens), so the summed
      // per-lens contribution must equal overallEvidenceScore exactly.
      assert.equal(result.agreement.bonus, 0);
      assert.ok(Math.abs(reconstructed - (result.overallEvidenceScore ?? 0)) < 1e-9);
    });

    test("a near-zero lens score yields a near-zero contribution — never a large percentage (P-1562 regression)", () => {
      // Mirrors P-1562: every lens consistent, only Geographic carries a tiny
      // non-zero score (~0.03). Its contribution to the 0-100 signal must be
      // well under one point, not ~59.
      const lenses: LensResults = {
        financial: financial({ score: 0, confidence: 0.56 }),
        geospatial: geospatial({ score: 0.0297, confidence: 0.4 }),
        temporal: temporal({ score: 0, confidence: 0.74 }),
        text: text({ score: 0, confidence: 0.72 }),
        visual: visual({ score: 0, confidence: 0.45 }),
      };
      const result = evaluateEvidenceFusion(lenses);
      const geo = result.lenses.find((l) => l.lens === "geospatial")!;
      const contributionPoints = (geo.score ?? 0) * geo.effectiveWeight * 100;
      assert.ok(contributionPoints < 1, `geographic contribution should be < 1 point, got ${contributionPoints}`);
      assert.ok((result.overallEvidenceScore ?? 0) * 100 < 1, "overall signal should round to 0%");
      // And it is genuinely a different quantity from the raw lens score (~3%).
      assert.ok(Math.round((geo.score ?? 0) * 100) === 3);
    });
  });
});
