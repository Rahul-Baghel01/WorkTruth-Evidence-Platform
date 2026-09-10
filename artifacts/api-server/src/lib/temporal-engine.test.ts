import "./test-env";
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { evaluateTemporalEvidence, type ProjectDates, type RawFinancialEvent, type RawImageEvent, type RawProgressRecord } from "./temporal-engine";

const NOW = new Date("2024-12-01T00:00:00Z");
const dates: ProjectDates = { startDate: "2024-01-15", expectedCompletion: "2024-07-15", actualCompletion: null };
const noProgress: RawProgressRecord[] = [];
const noFinancial: RawFinancialEvent[] = [];
const noImages: RawImageEvent[] = [];

describe("evaluateTemporalEvidence", () => {
  test("A. no temporal evidence at all -> INSUFFICIENT_EVIDENCE", () => {
    const result = evaluateTemporalEvidence(dates, noProgress, noFinancial, noImages, NOW);
    assert.equal(result.status, "INSUFFICIENT_EVIDENCE");
    assert.equal(result.score, null);
    assert.equal(result.confidence, 0);
    assert.ok(result.reasons.some((r) => r.includes("No dated evidence")));
  });

  test("B. one dated record -> limited confidence, noted explicitly", () => {
    const progress: RawProgressRecord[] = [{ id: 1, reportDate: "2024-02-01", progressPercent: 20 }];
    const result = evaluateTemporalEvidence(dates, progress, noFinancial, noImages, NOW);
    assert.notEqual(result.status, "INSUFFICIENT_EVIDENCE");
    assert.ok(result.checks.some((c) => c.name === "single_event_low_confidence"));
    assert.ok(result.reasons.some((r) => r.includes("temporal confidence is limited")));
    assert.ok(result.confidence < 0.4);
  });

  test("C. multiple chronologically consistent progress records: no anomaly", () => {
    const progress: RawProgressRecord[] = [
      { id: 1, reportDate: "2024-02-01", progressPercent: 10 },
      { id: 2, reportDate: "2024-03-01", progressPercent: 35 },
      { id: 3, reportDate: "2024-04-01", progressPercent: 60 },
    ];
    const result = evaluateTemporalEvidence(dates, progress, noFinancial, noImages, NOW);
    assert.equal(result.status, "TEMPORALLY_CONSISTENT");
    assert.equal(result.progressChange, 50);
    assert.ok(result.elapsedDays !== null && result.elapsedDays > 0);
    assert.ok(result.progressRatePerDay !== null);
    assert.ok(result.reasons.some((r) => r.includes("increased from 10% to 60%")));
    assert.ok(!result.checks.some((c) => c.severity === "HIGH" || c.severity === "MODERATE"));
  });

  test("D. progress decreases unexpectedly is flagged", () => {
    const progress: RawProgressRecord[] = [
      { id: 1, reportDate: "2024-02-01", progressPercent: 100 },
      { id: 2, reportDate: "2024-03-01", progressPercent: 40 },
    ];
    const result = evaluateTemporalEvidence(dates, progress, noFinancial, noImages, NOW);
    assert.equal(result.status, "TEMPORAL_ANOMALY");
    const decrease = result.checks.find((c) => c.name === "progress_decreased");
    assert.ok(decrease);
    assert.equal(decrease?.severity, "HIGH");
    assert.ok(result.reasons.some((r) => r.includes("decreased from 100% to 40%")));
  });

  test("E. duplicate/conflicting progress records are flagged", () => {
    const conflicting: RawProgressRecord[] = [
      { id: 1, reportDate: "2024-02-01", progressPercent: 20 },
      { id: 2, reportDate: "2024-02-01", progressPercent: 45 },
    ];
    const resultConflict = evaluateTemporalEvidence(dates, conflicting, noFinancial, noImages, NOW);
    assert.ok(resultConflict.checks.some((c) => c.name === "conflicting_progress_reports"));

    const duplicate: RawProgressRecord[] = [
      { id: 1, reportDate: "2024-02-01", progressPercent: 20 },
      { id: 2, reportDate: "2024-02-01", progressPercent: 20 },
    ];
    const resultDuplicate = evaluateTemporalEvidence(dates, duplicate, noFinancial, noImages, NOW);
    assert.ok(resultDuplicate.checks.some((c) => c.name === "duplicate_progress_report"));
  });

  test("F. financial event before a known sanction date is flagged", () => {
    const financial: RawFinancialEvent[] = [
      { id: 1, type: "SANCTION", recordedDate: "2024-02-01", amount: 1_000_000 },
      { id: 2, type: "EXPENDITURE", recordedDate: "2024-01-20", amount: 100_000 }, // before sanction
    ];
    const result = evaluateTemporalEvidence(dates, noProgress, financial, noImages, NOW);
    const check = result.checks.find((c) => c.name === "financial_before_sanction");
    assert.ok(check);
    assert.equal(check?.severity, "HIGH");
    assert.equal(result.status, "TEMPORAL_ANOMALY");
  });

  test("G. evidence image after a known completion date is flagged", () => {
    const withCompletion: ProjectDates = { ...dates, actualCompletion: "2024-07-15" };
    const images: RawImageEvent[] = [{ id: 1, capturedAt: "2024-08-01" }];
    const result = evaluateTemporalEvidence(withCompletion, noProgress, noFinancial, images, NOW);
    const check = result.checks.find((c) => c.name === "evidence_image_after_completion");
    assert.ok(check);
    assert.ok(result.reasons.some((r) => r.includes("captured after the recorded completion date")));
  });

  test("H. progress/image chronology consistency: no anomaly when images sit within the progress window", () => {
    const progress: RawProgressRecord[] = [
      { id: 1, reportDate: "2024-02-01", progressPercent: 10 },
      { id: 2, reportDate: "2024-04-01", progressPercent: 60 },
    ];
    const images: RawImageEvent[] = [{ id: 1, capturedAt: "2024-03-01" }];
    const result = evaluateTemporalEvidence(dates, progress, noFinancial, images, NOW);
    assert.equal(result.imageWithDateCount, 1);
    assert.ok(!result.checks.some((c) => c.name === "evidence_image_before_start" || c.name === "evidence_image_after_completion"));
  });

  test("I. missing image capture dates are treated as unavailable, not fabricated", () => {
    const images: RawImageEvent[] = [{ id: 1, capturedAt: null }];
    const progress: RawProgressRecord[] = [{ id: 1, reportDate: "2024-02-01", progressPercent: 20 }];
    const result = evaluateTemporalEvidence(dates, progress, noFinancial, images, NOW);
    assert.equal(result.imageWithDateCount, 0);
  });

  test("J. invalid/malformed dates are excluded, not silently used", () => {
    const progress: RawProgressRecord[] = [
      { id: 1, reportDate: "not-a-date", progressPercent: 20 },
      { id: 2, reportDate: "2024-02-01", progressPercent: 150 }, // invalid percent
    ];
    const result = evaluateTemporalEvidence(dates, progress, noFinancial, noImages, NOW);
    assert.equal(result.progressRecordCount, 0);
    assert.ok(result.checks.some((c) => c.name === "invalid_dates_excluded"));
  });

  test("future-dated evidence is excluded and flagged, not used as-is", () => {
    const progress: RawProgressRecord[] = [{ id: 1, reportDate: "2025-06-01", progressPercent: 20 }]; // after NOW
    const result = evaluateTemporalEvidence(dates, progress, noFinancial, noImages, NOW);
    assert.equal(result.progressRecordCount, 0);
    assert.ok(result.checks.some((c) => c.name === "future_dated_evidence"));
  });

  test("K. deterministic: identical input produces identical output", () => {
    const progress: RawProgressRecord[] = [
      { id: 1, reportDate: "2024-02-01", progressPercent: 10 },
      { id: 2, reportDate: "2024-03-01", progressPercent: 60 },
    ];
    const financial: RawFinancialEvent[] = [{ id: 1, type: "SANCTION", recordedDate: "2024-01-10", amount: 1_000_000 }];
    const resultA = evaluateTemporalEvidence(dates, progress, financial, noImages, NOW);
    const resultB = evaluateTemporalEvidence(dates, progress, financial, noImages, NOW);
    assert.deepEqual(resultA, resultB);
  });

  test("L. no project-ID-specific behavior: evaluator never receives a project id", () => {
    // evaluateTemporalEvidence's signature has no project-id parameter at
    // all, so it structurally cannot special-case any specific project.
    // This test locks in that two different project *records* with the
    // same dates/evidence produce the same result.
    const progress: RawProgressRecord[] = [
      { id: 1, reportDate: "2024-02-01", progressPercent: 10 },
      { id: 2, reportDate: "2024-03-01", progressPercent: 60 },
    ];
    const resultA = evaluateTemporalEvidence(dates, progress, noFinancial, noImages, NOW);
    const resultB = evaluateTemporalEvidence(dates, progress, noFinancial, noImages, NOW);
    assert.equal(resultA.score, resultB.score);
    assert.equal(resultA.status, resultB.status);
    // Not the old hardcoded is1089/is4150 constants (0.8 / 0.61) from before P0-G.
    assert.notEqual(resultA.score, 0.8);
    assert.notEqual(resultA.score, 0.61);
  });

  test("project-level date contradiction is checked even with zero optional evidence", () => {
    const contradictory: ProjectDates = { startDate: "2024-08-01", expectedCompletion: "2024-01-01", actualCompletion: null };
    const result = evaluateTemporalEvidence(contradictory, noProgress, noFinancial, noImages, NOW);
    assert.notEqual(result.status, "INSUFFICIENT_EVIDENCE");
    assert.ok(result.checks.some((c) => c.name === "start_after_expected_completion" && c.severity === "HIGH"));
  });

  test("actual completion before start is flagged", () => {
    const contradictory: ProjectDates = { startDate: "2024-06-01", expectedCompletion: "2024-12-01", actualCompletion: "2024-03-01" };
    const result = evaluateTemporalEvidence(contradictory, noProgress, noFinancial, noImages, NOW);
    assert.ok(result.checks.some((c) => c.name === "actual_completion_before_start"));
  });
});
