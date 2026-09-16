import "./test-env";
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { evaluateCrossModalInconsistencies, type CrossModalInput, type CrossModalProject } from "./cross-modal-engine";
import type { FinancialAnalysisResult } from "./financial-engine";
import type { GeoAnalysisResult, GeoEvidencePoint } from "./geo-engine";
import type { TemporalAnalysisResult } from "./temporal-engine";
import type { TextAnalysisResult } from "./text-engine";
import type { VisualAnalysisResult } from "./visual-engine";

// ---------------------------------------------------------------------------
// Fixture builders — mirrors the pattern in fusion-engine.test.ts. These are
// pure fixtures shaped like each engine's real result, never calls into the
// real compute*Analysis DB wrappers.
// ---------------------------------------------------------------------------

function project(overrides: Partial<CrossModalProject> = {}): CrossModalProject {
  return {
    id: "P-TEST",
    category: "Road",
    description: "Resurfacing of the village approach road with culvert repair.",
    latitude: 26.45,
    longitude: 80.33,
    startDate: "2024-01-01",
    expectedCompletion: "2024-06-01",
    actualCompletion: null,
    ...overrides,
  };
}

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
    peerGroup: { dimension: "category", size: 5, median: 0.5, mean: 0.5, standardDeviation: 0.1, mad: 0.05, percentileRank: 0.5, medianSanction: 1000000, costRatio: 1 },
    checks: [{ name: "expenditure_ratio_normal", severity: "INFO", message: "Expenditure ratio is within the expected range." }],
    reasons: ["Expenditure ratio is within the expected range."],
    recordCount: 6,
    engineVersion: "financial-v1",
    updatedAt: "2025-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function geospatial(points: GeoEvidencePoint[] = [], overrides: Partial<GeoAnalysisResult> = {}): GeoAnalysisResult {
  return {
    status: "LOCATION_CONSISTENT",
    score: 0.05,
    confidence: 0.8,
    declaredLatitude: 26.45,
    declaredLongitude: 80.33,
    imageCount: points.length,
    validGpsCount: points.filter((p) => p.hasValidGps).length,
    invalidGpsCount: 0,
    missingGpsCount: 0,
    minDistanceMeters: 10,
    maxDistanceMeters: 50,
    medianDistanceMeters: 20,
    points,
    checks: [{ name: "location_consistent", severity: "INFO", message: "Evidence GPS is consistent with the recorded project location." }],
    reasons: ["Evidence GPS is consistent with the recorded project location."],
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
    checks: [{ name: "category_keyword_match", severity: "INFO", message: "Description contains expected category keywords." }],
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
    crossProjectMatch: null,
    engineVersion: "visual-v1",
    updatedAt: "2025-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function baseInput(overrides: Partial<CrossModalInput> = {}): CrossModalInput {
  return {
    project: project(),
    financial: financial(),
    geospatial: geospatial(),
    temporal: temporal(),
    text: text(),
    visual: visual(),
    rawFinancialRecords: [],
    rawProgressRecords: [],
    rawEvidenceImages: [],
    ...overrides,
  };
}

describe("evaluateCrossModalInconsistencies", () => {
  // A. Financial <-> Temporal: activity before sanction, corroborated by both engines
  test("A1: both financial and temporal engines flagging the same pre-sanction spending produce ONE cross-modal inconsistency", () => {
    const input = baseInput({
      financial: financial({
        status: "ANOMALY_DETECTED",
        score: 0.5,
        checks: [{ name: "expenditure_before_sanction", severity: "HIGH", message: "Expenditure before sanction.", supportingRecordIds: [1] }],
      }),
      temporal: temporal({
        status: "TEMPORAL_ANOMALY",
        score: 0.5,
        checks: [{ name: "financial_before_sanction", severity: "HIGH", message: "Financial record before sanction.", supportingRecordIds: [1] }],
      }),
      rawFinancialRecords: [
        { id: 1, type: "EXPENDITURE", amount: 100000, recordedDate: "2023-12-01" },
        { id: 2, type: "SANCTION", amount: 1000000, recordedDate: "2024-01-01" },
      ],
    });
    const result = evaluateCrossModalInconsistencies(input);
    const matches = result.items.filter((i) => i.type === "financial_temporal_activity_before_sanction");
    assert.equal(matches.length, 1);
    assert.deepEqual(matches[0].dimensions.sort(), ["financial", "temporal"]);
    assert.equal(matches[0].supportingChecks.length, 2);
    assert.ok(matches[0].evidenceReferences.some((r) => r.id === 1));
  });

  test("A1: escalates to CRITICAL when pre-sanction spending is a large share of the sanctioned amount", () => {
    const input = baseInput({
      financial: financial({
        status: "ANOMALY_DETECTED",
        checks: [{ name: "expenditure_before_sanction", severity: "HIGH", message: "x", supportingRecordIds: [1] }],
      }),
      temporal: temporal({
        status: "TEMPORAL_ANOMALY",
        checks: [{ name: "financial_before_sanction", severity: "HIGH", message: "x", supportingRecordIds: [1] }],
      }),
      rawFinancialRecords: [
        { id: 1, type: "EXPENDITURE", amount: 500000, recordedDate: "2023-12-01" },
        { id: 2, type: "SANCTION", amount: 1000000, recordedDate: "2024-01-01" },
      ],
    });
    const result = evaluateCrossModalInconsistencies(input);
    const match = result.items.find((i) => i.type === "financial_temporal_activity_before_sanction");
    assert.equal(match?.severity, "CRITICAL");
  });

  test("A1: does NOT fire when only one engine flags the check (requires two independent dimensions)", () => {
    const input = baseInput({
      financial: financial({ status: "WITHIN_EXPECTED_RANGE" }), // financial did NOT flag expenditure_before_sanction
      temporal: temporal({
        status: "TEMPORAL_ANOMALY",
        checks: [{ name: "financial_before_sanction", severity: "HIGH", message: "x", supportingRecordIds: [1] }],
      }),
      rawFinancialRecords: [{ id: 1, type: "EXPENDITURE", amount: 100000, recordedDate: "2023-12-01" }],
    });
    const result = evaluateCrossModalInconsistencies(input);
    assert.equal(result.items.filter((i) => i.type === "financial_temporal_activity_before_sanction").length, 0);
  });

  // A2/A3: temporal-only financial checks promoted to cross-modal objects
  test("A2: financial activity before project start is promoted to a structured Financial<->Temporal inconsistency", () => {
    const input = baseInput({
      temporal: temporal({
        status: "TEMPORAL_ANOMALY",
        checks: [{ name: "financial_before_start", severity: "MODERATE", message: "Predates start.", supportingRecordIds: [7] }],
      }),
      rawFinancialRecords: [{ id: 7, type: "EXPENDITURE", amount: 20000, recordedDate: "2023-12-01" }],
    });
    const result = evaluateCrossModalInconsistencies(input);
    const match = result.items.find((i) => i.type === "financial_temporal_activity_before_start");
    assert.ok(match);
    assert.equal(match?.severity, "MODERATE");
    assert.deepEqual(match?.dimensions.sort(), ["financial", "temporal"]);
  });

  test("A3: financial activity after completion is promoted with HIGH severity, matching temporal-engine's own severity", () => {
    const input = baseInput({
      temporal: temporal({
        status: "TEMPORAL_ANOMALY",
        checks: [{ name: "financial_after_completion", severity: "HIGH", message: "After completion.", supportingRecordIds: [9] }],
      }),
      rawFinancialRecords: [{ id: 9, type: "PAYMENT", amount: 40000, recordedDate: "2024-08-01" }],
    });
    const result = evaluateCrossModalInconsistencies(input);
    const match = result.items.find((i) => i.type === "financial_temporal_activity_after_completion");
    assert.equal(match?.severity, "HIGH");
  });

  // B. Geospatial <-> Visual: reused image at a different location
  test("B1: an exact-duplicate image pair with materially different GPS is flagged HIGH", () => {
    const points: GeoEvidencePoint[] = [
      { imageId: 1, label: null, hasValidGps: true, latitude: 26.45, longitude: 80.33, accuracyMeters: 5, distanceMeters: 10, invalidReason: null },
      { imageId: 2, label: null, hasValidGps: true, latitude: 26.90, longitude: 80.90, accuracyMeters: 5, distanceMeters: 60000, invalidReason: null },
    ];
    const input = baseInput({
      geospatial: geospatial(points),
      visual: visual({
        status: "REQUIRES_VERIFICATION",
        checks: [{ name: "exact_duplicate_files", severity: "HIGH", message: "Identical files.", supportingImageIds: [1, 2] }],
      }),
    });
    const result = evaluateCrossModalInconsistencies(input);
    const match = result.items.find((i) => i.type === "geo_visual_reused_image_different_location");
    assert.ok(match);
    assert.equal(match?.severity, "HIGH");
    assert.deepEqual(match?.dimensions.sort(), ["geospatial", "visual"]);
  });

  test("B1: a near-duplicate pair with different GPS is MODERATE, not HIGH (more conservative than exact duplicates)", () => {
    const points: GeoEvidencePoint[] = [
      { imageId: 1, label: null, hasValidGps: true, latitude: 26.45, longitude: 80.33, accuracyMeters: 5, distanceMeters: 10, invalidReason: null },
      { imageId: 2, label: null, hasValidGps: true, latitude: 26.90, longitude: 80.90, accuracyMeters: 5, distanceMeters: 60000, invalidReason: null },
    ];
    const input = baseInput({
      geospatial: geospatial(points),
      visual: visual({
        status: "REQUIRES_VERIFICATION",
        checks: [{ name: "near_duplicate_images", severity: "MODERATE", message: "Near-identical.", supportingImageIds: [1, 2] }],
      }),
    });
    const result = evaluateCrossModalInconsistencies(input);
    const match = result.items.find((i) => i.type === "geo_visual_reused_image_different_location");
    assert.equal(match?.severity, "MODERATE");
  });

  test("B1: does NOT fire when the duplicate pair's GPS is close together (within plausible drift)", () => {
    const points: GeoEvidencePoint[] = [
      { imageId: 1, label: null, hasValidGps: true, latitude: 26.45, longitude: 80.33, accuracyMeters: 5, distanceMeters: 10, invalidReason: null },
      { imageId: 2, label: null, hasValidGps: true, latitude: 26.4501, longitude: 80.3301, accuracyMeters: 5, distanceMeters: 15, invalidReason: null },
    ];
    const input = baseInput({
      geospatial: geospatial(points),
      visual: visual({
        status: "REQUIRES_VERIFICATION",
        checks: [{ name: "exact_duplicate_files", severity: "HIGH", message: "Identical files.", supportingImageIds: [1, 2] }],
      }),
    });
    const result = evaluateCrossModalInconsistencies(input);
    assert.equal(result.items.filter((i) => i.type === "geo_visual_reused_image_different_location").length, 0);
  });

  // D. Visual <-> Temporal: same content, different dates
  test("D1: no_visual_change_across_dates is promoted to a Visual<->Temporal inconsistency with real dates attached", () => {
    const input = baseInput({
      visual: visual({
        status: "REQUIRES_VERIFICATION",
        checks: [{ name: "no_visual_change_across_dates", severity: "MODERATE", message: "No visible change.", supportingImageIds: [3, 4] }],
      }),
      rawEvidenceImages: [
        { id: 3, label: null, gpsLatitude: null, gpsLongitude: null, gpsAccuracyMeters: null, capturedAt: "2024-01-10T00:00:00.000Z", perceptualHash: null, sha256: null },
        { id: 4, label: null, gpsLatitude: null, gpsLongitude: null, gpsAccuracyMeters: null, capturedAt: "2024-05-10T00:00:00.000Z", perceptualHash: null, sha256: null },
      ],
    });
    const result = evaluateCrossModalInconsistencies(input);
    const match = result.items.find((i) => i.type === "visual_temporal_no_change_across_dates");
    assert.ok(match);
    assert.equal(match?.evidenceReferences.length, 2);
    assert.ok(match?.evidenceReferences.some((r) => r.value === "2024-01-10"));
  });

  // E. Financial <-> Progress: spend/progress ratio mismatch (heuristic)
  test("E1: high spend with low reported progress is flagged HIGH and explicitly labeled a heuristic", () => {
    const input = baseInput({
      financial: financial({ expenditureRatio: 0.9 }),
      rawProgressRecords: [{ id: 1, reportDate: "2024-03-01", progressPercent: 15 }],
    });
    const result = evaluateCrossModalInconsistencies(input);
    const match = result.items.find((i) => i.type === "financial_progress_ratio_mismatch");
    assert.ok(match);
    assert.equal(match?.severity, "HIGH");
    assert.match(match!.description, /heuristic/i);
  });

  test("E1: high reported progress with very little recorded spending is flagged MODERATE", () => {
    const input = baseInput({
      financial: financial({ expenditureRatio: 0.05 }),
      rawProgressRecords: [{ id: 1, reportDate: "2024-05-01", progressPercent: 95 }],
    });
    const result = evaluateCrossModalInconsistencies(input);
    const match = result.items.find((i) => i.type === "financial_progress_ratio_mismatch");
    assert.equal(match?.severity, "MODERATE");
  });

  test("E1: does NOT fire when spend and progress are proportionate", () => {
    const input = baseInput({
      financial: financial({ expenditureRatio: 0.5 }),
      rawProgressRecords: [{ id: 1, reportDate: "2024-03-01", progressPercent: 50 }],
    });
    const result = evaluateCrossModalInconsistencies(input);
    assert.equal(result.items.filter((i) => i.type === "financial_progress_ratio_mismatch").length, 0);
  });

  // F. Text <-> Category
  test("F1: a category/keyword mismatch is promoted at LOW severity only, never amplified", () => {
    const input = baseInput({
      text: text({
        status: "CONSISTENT",
        checks: [{ name: "category_keyword_mismatch", severity: "LOW", message: "Weak category consistency." }],
      }),
    });
    const result = evaluateCrossModalInconsistencies(input);
    const match = result.items.find((i) => i.type === "text_category_mismatch");
    assert.ok(match);
    assert.equal(match?.severity, "LOW");
    assert.deepEqual(match?.dimensions.sort(), ["category", "text"]);
  });

  // Missing evidence -> no inconsistency (never suspicion)
  test("missing evidence produces no inconsistencies at all, even when a single lens is anomalous", () => {
    const input = baseInput({
      financial: financial({ status: "INSUFFICIENT_EVIDENCE", score: null, confidence: 0, checks: [], reasons: ["No financial evidence."] }),
      temporal: temporal({ status: "INSUFFICIENT_EVIDENCE", score: null, confidence: 0, checks: [], reasons: ["No temporal evidence."] }),
    });
    const result = evaluateCrossModalInconsistencies(input);
    assert.equal(result.items.length, 0);
  });

  test("an isolated single-lens anomaly (no corroboration) does not, by itself, produce a Financial<->Temporal inconsistency", () => {
    const input = baseInput({
      financial: financial({ status: "ANOMALY_DETECTED", checks: [{ name: "expenditure_exceeds_sanction", severity: "HIGH", message: "x" }] }),
    });
    const result = evaluateCrossModalInconsistencies(input);
    assert.equal(result.items.length, 0);
  });

  // Determinism
  test("identical input produces identical inconsistency ids and severities across repeated calls", () => {
    const input = baseInput({
      financial: financial({
        status: "ANOMALY_DETECTED",
        checks: [{ name: "expenditure_before_sanction", severity: "HIGH", message: "x", supportingRecordIds: [1] }],
      }),
      temporal: temporal({
        status: "TEMPORAL_ANOMALY",
        checks: [{ name: "financial_before_sanction", severity: "HIGH", message: "x", supportingRecordIds: [1] }],
      }),
      rawFinancialRecords: [
        { id: 1, type: "EXPENDITURE", amount: 100000, recordedDate: "2023-12-01" },
        { id: 2, type: "SANCTION", amount: 1000000, recordedDate: "2024-01-01" },
      ],
    });
    const a = evaluateCrossModalInconsistencies(input);
    const b = evaluateCrossModalInconsistencies(input);
    assert.deepEqual(a.items.map((i) => i.id).sort(), b.items.map((i) => i.id).sort());
    assert.deepEqual(a.items.map((i) => i.severity), b.items.map((i) => i.severity));
  });

  // Not every inconsistency is HIGH — severities span the vocabulary
  test("severities are not uniformly HIGH across the different rule types", () => {
    const input = baseInput({
      financial: financial({ expenditureRatio: 0.05 }),
      temporal: temporal({
        status: "TEMPORAL_ANOMALY",
        checks: [{ name: "financial_before_start", severity: "MODERATE", message: "x", supportingRecordIds: [1] }],
      }),
      text: text({ checks: [{ name: "category_keyword_mismatch", severity: "LOW", message: "x" }] }),
      rawFinancialRecords: [{ id: 1, type: "EXPENDITURE", amount: 20000, recordedDate: "2023-12-01" }],
      rawProgressRecords: [{ id: 1, reportDate: "2024-05-01", progressPercent: 95 }],
    });
    const result = evaluateCrossModalInconsistencies(input);
    const severities = new Set(result.items.map((i) => i.severity));
    assert.ok(severities.size > 1, `expected varied severities, got ${[...severities].join(", ")}`);
    assert.ok(!result.items.every((i) => i.severity === "HIGH"));
  });

  // Confidence separate from severity
  test("confidence is a separate axis from severity: two-engine corroboration yields higher confidence than single-engine promotion at the same severity tier", () => {
    const corroborated = baseInput({
      financial: financial({
        status: "ANOMALY_DETECTED",
        confidence: 0.9,
        checks: [{ name: "expenditure_before_sanction", severity: "HIGH", message: "x", supportingRecordIds: [1] }],
      }),
      temporal: temporal({
        status: "TEMPORAL_ANOMALY",
        confidence: 0.9,
        checks: [{ name: "financial_before_sanction", severity: "HIGH", message: "x", supportingRecordIds: [1] }],
      }),
      rawFinancialRecords: [
        { id: 1, type: "EXPENDITURE", amount: 50000, recordedDate: "2023-12-01" },
        { id: 2, type: "SANCTION", amount: 1000000, recordedDate: "2024-01-01" },
      ],
    });
    const singleEngine = baseInput({
      temporal: temporal({
        confidence: 0.9,
        status: "TEMPORAL_ANOMALY",
        checks: [{ name: "financial_after_completion", severity: "HIGH", message: "x", supportingRecordIds: [9] }],
      }),
      rawFinancialRecords: [{ id: 9, type: "PAYMENT", amount: 40000, recordedDate: "2024-08-01" }],
    });
    const a = evaluateCrossModalInconsistencies(corroborated).items.find((i) => i.type === "financial_temporal_activity_before_sanction")!;
    const b = evaluateCrossModalInconsistencies(singleEngine).items.find((i) => i.type === "financial_temporal_activity_after_completion")!;
    assert.equal(a.severity, "HIGH");
    assert.equal(b.severity, "HIGH");
    assert.ok(a.confidence >= b.confidence, `expected two-engine confidence (${a.confidence}) >= single-engine confidence (${b.confidence})`);
  });

  // No project-ID-specific behavior
  test("no project-ID-specific behavior: identical evidence produces identical results regardless of project id", () => {
    const inputA = baseInput({ project: project({ id: "P-1089" }) });
    const inputB = baseInput({ project: project({ id: "P-9999" }) });
    const a = evaluateCrossModalInconsistencies(inputA);
    const b = evaluateCrossModalInconsistencies(inputB);
    assert.deepEqual(a.countsBySeverity, b.countsBySeverity);
    assert.equal(a.items.length, b.items.length);
  });

  test("countsBySeverity accurately reflects the items produced", () => {
    const input = baseInput({
      financial: financial({
        status: "ANOMALY_DETECTED",
        checks: [{ name: "expenditure_before_sanction", severity: "HIGH", message: "x", supportingRecordIds: [1] }],
      }),
      temporal: temporal({
        status: "TEMPORAL_ANOMALY",
        checks: [{ name: "financial_before_sanction", severity: "HIGH", message: "x", supportingRecordIds: [1] }],
      }),
      text: text({ checks: [{ name: "category_keyword_mismatch", severity: "LOW", message: "x" }] }),
      rawFinancialRecords: [
        { id: 1, type: "EXPENDITURE", amount: 50000, recordedDate: "2023-12-01" },
        { id: 2, type: "SANCTION", amount: 1000000, recordedDate: "2024-01-01" },
      ],
    });
    const result = evaluateCrossModalInconsistencies(input);
    const manualCounts: Record<string, number> = { INFO: 0, LOW: 0, MODERATE: 0, HIGH: 0, CRITICAL: 0 };
    for (const item of result.items) manualCounts[item.severity] += 1;
    assert.deepEqual(result.countsBySeverity, manualCounts);
  });
});
