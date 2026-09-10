import { eq } from "drizzle-orm";
import { db, evidenceImagesTable, financialRecordsTable, progressRecordsTable, type ProjectRow } from "@workspace/db";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export const TEMPORAL_ENGINE_VERSION = "temporal-v1";

export type TemporalCheckSeverity = "INFO" | "LOW" | "MODERATE" | "HIGH";

export type TemporalCheck = {
  name: string;
  severity: TemporalCheckSeverity;
  message: string;
  observed?: Record<string, number>;
  supportingRecordIds?: number[];
};

export type TemporalStatus = "INSUFFICIENT_EVIDENCE" | "TEMPORALLY_CONSISTENT" | "TEMPORAL_ANOMALY";

export type TemporalAnalysisResult = {
  status: TemporalStatus;
  score: number | null;
  confidence: number;
  progressRecordCount: number;
  financialRecordCount: number;
  imageWithDateCount: number;
  firstEventDate: string | null;
  lastEventDate: string | null;
  firstProgressDate: string | null;
  lastProgressDate: string | null;
  progressReportCount: number;
  elapsedDays: number | null;
  progressChange: number | null;
  progressRatePerDay: number | null;
  checks: TemporalCheck[];
  reasons: string[];
  engineVersion: string;
  updatedAt: string;
};

export type RawProgressRecord = { id: number; reportDate: string; progressPercent: number };
export type RawFinancialEvent = { id: number; type: string; recordedDate: string; amount: number };
export type RawImageEvent = { id: number; capturedAt: string | Date | null };
export type ProjectDates = { startDate: string; expectedCompletion: string; actualCompletion: string | null };

// ---------------------------------------------------------------------------
// Tunable constants — documented so the score is reproducible and explainable.
// These are configurable heuristics, not statistically calibrated thresholds.
// ---------------------------------------------------------------------------

const SEVERITY_WEIGHT: Record<TemporalCheckSeverity, number> = { INFO: 0, LOW: 0.1, MODERATE: 0.25, HIGH: 0.5 };

// score >= this maps to TEMPORAL_ANOMALY, otherwise TEMPORALLY_CONSISTENT.
const ANOMALY_SCORE_THRESHOLD = 0.35;

// A progress increase of at least this many percentage points within
// LARGE_JUMP_MAX_DAYS is flagged as an unusually rapid change. Real projects
// can legitimately jump (e.g. a batch of work signed off at once), so this
// is deliberately generous rather than enforcing a linear schedule.
const LARGE_JUMP_MIN_INCREASE = 40;
const LARGE_JUMP_MAX_DAYS = 3;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function parseDate(value: string | Date | null | undefined): Date | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function daysBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / 86_400_000);
}

function isFinancialRecordType(value: string): value is "SANCTION" | "EXPENDITURE" | "PAYMENT" {
  return value === "SANCTION" || value === "EXPENDITURE" || value === "PAYMENT";
}

// ---------------------------------------------------------------------------
// Pure evaluation — no I/O, fully unit-testable with synthetic fixtures.
// `now` defaults to the real clock but is a parameter specifically so tests
// are deterministic and don't depend on wall-clock time.
// ---------------------------------------------------------------------------

export function evaluateTemporalEvidence(
  projectDates: ProjectDates,
  rawProgress: RawProgressRecord[],
  rawFinancial: RawFinancialEvent[],
  rawImages: RawImageEvent[],
  now: Date = new Date(),
): TemporalAnalysisResult {
  const checks: TemporalCheck[] = [];
  const reasons: string[] = [];
  const nowIso = now.toISOString();

  // --- project-level reference dates: always present (startDate,
  // expectedCompletion are NOT NULL columns), so their internal consistency
  // can always be checked, independent of whether optional evidence exists.
  const startDate = parseDate(projectDates.startDate);
  const expectedCompletion = parseDate(projectDates.expectedCompletion);
  const actualCompletion = parseDate(projectDates.actualCompletion);

  if (startDate && expectedCompletion && startDate.getTime() > expectedCompletion.getTime()) {
    checks.push({
      name: "start_after_expected_completion",
      severity: "HIGH",
      message: `The project's start date (${projectDates.startDate}) is after its expected completion date (${projectDates.expectedCompletion}).`,
    });
  }
  if (startDate && actualCompletion && actualCompletion.getTime() < startDate.getTime()) {
    checks.push({
      name: "actual_completion_before_start",
      severity: "HIGH",
      message: `The project's recorded completion date (${projectDates.actualCompletion}) is before its start date (${projectDates.startDate}).`,
    });
  }

  // --- normalize progress records ---
  const validProgress: Array<{ id: number; date: Date; percent: number }> = [];
  let invalidProgressCount = 0;
  let futureProgressCount = 0;
  for (const r of rawProgress) {
    const d = parseDate(r.reportDate);
    const validPercent = Number.isFinite(r.progressPercent) && r.progressPercent >= 0 && r.progressPercent <= 100;
    if (!d || !validPercent) {
      invalidProgressCount += 1;
      continue;
    }
    if (d.getTime() > now.getTime()) {
      futureProgressCount += 1;
      continue;
    }
    validProgress.push({ id: r.id, date: d, percent: r.progressPercent });
  }
  validProgress.sort((a, b) => a.date.getTime() - b.date.getTime());

  // --- normalize financial records ---
  const validFinancial: Array<{ id: number; type: "SANCTION" | "EXPENDITURE" | "PAYMENT"; date: Date; amount: number }> = [];
  let invalidFinancialCount = 0;
  let futureFinancialCount = 0;
  for (const r of rawFinancial) {
    const d = parseDate(r.recordedDate);
    const validAmount = Number.isFinite(r.amount) && r.amount > 0;
    if (!d || !isFinancialRecordType(r.type) || !validAmount) {
      invalidFinancialCount += 1;
      continue;
    }
    if (d.getTime() > now.getTime()) {
      futureFinancialCount += 1;
      continue;
    }
    validFinancial.push({ id: r.id, type: r.type, date: d, amount: r.amount });
  }

  // --- normalize evidence-image capture dates (never uploadedAt) ---
  const validImages: Array<{ id: number; date: Date }> = [];
  let futureImageCount = 0;
  for (const img of rawImages) {
    const d = parseDate(img.capturedAt);
    if (!d) continue; // missing/unavailable capture date — not an error, just unusable for chronology
    if (d.getTime() > now.getTime()) {
      futureImageCount += 1;
      continue;
    }
    validImages.push({ id: img.id, date: d });
  }

  const totalInvalid = invalidProgressCount + invalidFinancialCount;
  if (totalInvalid > 0) {
    checks.push({
      name: "invalid_dates_excluded",
      severity: "LOW",
      message: `${totalInvalid} record${totalInvalid === 1 ? "" : "s"} had an invalid or malformed date and could not be used (progress: ${invalidProgressCount}, financial: ${invalidFinancialCount}).`,
      observed: { progress: invalidProgressCount, financial: invalidFinancialCount },
    });
  }
  const totalFuture = futureProgressCount + futureFinancialCount + futureImageCount;
  if (totalFuture > 0) {
    checks.push({
      name: "future_dated_evidence",
      severity: "HIGH",
      message: `${totalFuture} record${totalFuture === 1 ? "" : "s"} had a date in the future and could not be used in chronological analysis (progress: ${futureProgressCount}, financial: ${futureFinancialCount}, images: ${futureImageCount}).`,
      observed: { progress: futureProgressCount, financial: futureFinancialCount, images: futureImageCount },
    });
  }

  const totalDatedEvents = validProgress.length + validFinancial.length + validImages.length;
  const hasProjectLevelAnomaly = checks.some((c) => c.name === "start_after_expected_completion" || c.name === "actual_completion_before_start");

  if (totalDatedEvents === 0 && !hasProjectLevelAnomaly) {
    reasons.push("No dated evidence (progress reports, financial records, or evidence images) was available for temporal analysis.");
    return {
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
      checks,
      reasons,
      engineVersion: TEMPORAL_ENGINE_VERSION,
      updatedAt: nowIso,
    };
  }

  if (totalDatedEvents === 1) {
    const singleEventCheck: TemporalCheck = { name: "single_event_low_confidence", severity: "INFO", message: "Only one dated evidence event was available; temporal confidence is limited." };
    checks.push(singleEventCheck);
    reasons.push(singleEventCheck.message);
  }

  // --- progress chronology checks ---
  const byDate = new Map<string, Array<{ id: number; date: Date; percent: number }>>();
  for (const p of validProgress) {
    const key = isoDay(p.date);
    const list = byDate.get(key) ?? [];
    list.push(p);
    byDate.set(key, list);
  }
  for (const group of byDate.values()) {
    if (group.length < 2) continue;
    const percents = new Set(group.map((g) => g.percent));
    if (percents.size > 1) {
      checks.push({
        name: "conflicting_progress_reports",
        severity: "MODERATE",
        message: `Multiple progress reports on ${isoDay(group[0].date)} disagree: ${[...percents].sort((a, b) => a - b).join("%, ")}%.`,
        supportingRecordIds: group.map((g) => g.id),
      });
    } else {
      checks.push({
        name: "duplicate_progress_report",
        severity: "LOW",
        message: `${group.length} identical progress reports of ${group[0].percent}% were recorded on ${isoDay(group[0].date)}.`,
        supportingRecordIds: group.map((g) => g.id),
      });
    }
  }

  for (let i = 1; i < validProgress.length; i++) {
    const prev = validProgress[i - 1];
    const curr = validProgress[i];
    if (curr.date.getTime() === prev.date.getTime()) continue; // handled by the duplicate/conflict check above
    const delta = curr.percent - prev.percent;
    const days = daysBetween(prev.date, curr.date);
    if (delta < 0) {
      const drop = Math.abs(delta);
      const severity: TemporalCheckSeverity = drop >= 30 ? "HIGH" : drop >= 10 ? "MODERATE" : "LOW";
      checks.push({
        name: "progress_decreased",
        severity,
        message: `Progress decreased from ${prev.percent}% to ${curr.percent}% between dated reports (${isoDay(prev.date)} to ${isoDay(curr.date)}).`,
        observed: { from: prev.percent, to: curr.percent, days },
        supportingRecordIds: [prev.id, curr.id],
      });
    } else if (delta >= LARGE_JUMP_MIN_INCREASE && days <= LARGE_JUMP_MAX_DAYS) {
      checks.push({
        name: "large_progress_jump",
        severity: "MODERATE",
        message: `Progress increased by ${delta} percentage points in ${days} day${days === 1 ? "" : "s"} (${prev.percent}% to ${curr.percent}%) — an unusually rapid change.`,
        observed: { from: prev.percent, to: curr.percent, days },
        supportingRecordIds: [prev.id, curr.id],
      });
    }
  }

  // --- progress descriptive statistics ---
  let firstProgressDate: string | null = null;
  let lastProgressDate: string | null = null;
  let progressChange: number | null = null;
  let elapsedDays: number | null = null;
  let progressRatePerDay: number | null = null;
  if (validProgress.length) {
    const first = validProgress[0];
    const last = validProgress[validProgress.length - 1];
    firstProgressDate = isoDay(first.date);
    lastProgressDate = isoDay(last.date);
    if (validProgress.length >= 2) {
      progressChange = last.percent - first.percent;
      elapsedDays = daysBetween(first.date, last.date);
      if (elapsedDays > 0) {
        progressRatePerDay = progressChange / elapsedDays;
        reasons.push(
          `Progress ${progressChange >= 0 ? "increased" : "decreased"} from ${first.percent}% to ${last.percent}% over ${elapsedDays} day${elapsedDays === 1 ? "" : "s"}.`,
        );
      } else {
        reasons.push(`Progress went from ${first.percent}% to ${last.percent}% with no elapsed time between the earliest and latest dated report.`);
      }
    } else {
      reasons.push(`Only one dated progress report was available (${first.percent}% on ${firstProgressDate}).`);
    }
  } else if (validFinancial.length || validImages.length) {
    reasons.push("No dated progress evidence was available.");
  }

  // --- financial timeline checks ---
  const sanctionDates = validFinancial.filter((f) => f.type === "SANCTION").map((f) => f.date);
  const earliestSanction = sanctionDates.length ? new Date(Math.min(...sanctionDates.map((d) => d.getTime()))) : null;
  const spendingRecords = validFinancial.filter((f) => f.type === "EXPENDITURE" || f.type === "PAYMENT");

  if (earliestSanction) {
    const before = spendingRecords.filter((f) => f.date.getTime() < (earliestSanction as Date).getTime());
    if (before.length) {
      checks.push({
        name: "financial_before_sanction",
        severity: "HIGH",
        message: `${before.length} financial record${before.length === 1 ? " was" : "s were"} recorded before the available sanction date (${isoDay(earliestSanction)}).`,
        observed: { count: before.length },
        supportingRecordIds: before.map((f) => f.id),
      });
    }
  }
  if (startDate && spendingRecords.length) {
    const beforeStart = spendingRecords.filter((f) => f.date.getTime() < (startDate as Date).getTime());
    if (beforeStart.length) {
      checks.push({
        name: "financial_before_start",
        severity: "MODERATE",
        message: `${beforeStart.length} expenditure/payment record${beforeStart.length === 1 ? "" : "s"} predate the project's start date (${projectDates.startDate}).`,
        supportingRecordIds: beforeStart.map((f) => f.id),
      });
    }
  }
  if (actualCompletion && spendingRecords.length) {
    const afterCompletion = spendingRecords.filter((f) => f.date.getTime() > (actualCompletion as Date).getTime());
    if (afterCompletion.length) {
      checks.push({
        name: "financial_after_completion",
        severity: "HIGH",
        message: `${afterCompletion.length} expenditure/payment record${afterCompletion.length === 1 ? "" : "s"} are dated after the recorded completion date (${projectDates.actualCompletion}).`,
        supportingRecordIds: afterCompletion.map((f) => f.id),
      });
    }
  }

  // --- evidence-image chronology checks ---
  if (startDate && validImages.length) {
    const before = validImages.filter((img) => img.date.getTime() < (startDate as Date).getTime());
    if (before.length) {
      checks.push({
        name: "evidence_image_before_start",
        severity: "MODERATE",
        message: `${before.length} evidence image${before.length === 1 ? " was" : "s were"} captured before the project's start date (${projectDates.startDate}).`,
        supportingRecordIds: before.map((i) => i.id),
      });
    }
  }
  if (actualCompletion && validImages.length) {
    const after = validImages.filter((img) => img.date.getTime() > (actualCompletion as Date).getTime());
    if (after.length) {
      checks.push({
        name: "evidence_image_after_completion",
        severity: "MODERATE",
        message: `${after.length === 1 ? "An evidence image was" : `${after.length} evidence images were`} captured after the recorded completion date (${projectDates.actualCompletion}).`,
        supportingRecordIds: after.map((i) => i.id),
      });
    }
  }

  // --- score, status, confidence ---
  const triggered = checks.filter((c) => c.severity !== "INFO");
  const score = clamp(triggered.reduce((sum, c) => sum + SEVERITY_WEIGHT[c.severity], 0), 0, 1);
  const status: TemporalStatus = score >= ANOMALY_SCORE_THRESHOLD ? "TEMPORAL_ANOMALY" : "TEMPORALLY_CONSISTENT";

  // Confidence rises with the number of corroborating dated events across
  // all sources, capped at 8+ events — independent of the anomaly score
  // itself (many consistent events raise confidence; many *contradictory*
  // events raise both confidence AND the score, deliberately).
  let confidence = 0.2 + Math.min(totalDatedEvents, 8) * 0.09;
  confidence = clamp(confidence, 0.1, 0.95);

  if (triggered.length) {
    for (const c of triggered) if (!reasons.includes(c.message)) reasons.push(c.message);
  } else {
    reasons.push("No temporal inconsistencies were detected in the available evidence.");
  }

  const allDates = [...validProgress.map((p) => p.date), ...validFinancial.map((f) => f.date), ...validImages.map((i) => i.date)];
  const firstEventDate = allDates.length ? isoDay(new Date(Math.min(...allDates.map((d) => d.getTime())))) : null;
  const lastEventDate = allDates.length ? isoDay(new Date(Math.max(...allDates.map((d) => d.getTime())))) : null;

  return {
    status,
    score,
    confidence,
    progressRecordCount: validProgress.length,
    financialRecordCount: validFinancial.length,
    imageWithDateCount: validImages.length,
    firstEventDate,
    lastEventDate,
    firstProgressDate,
    lastProgressDate,
    progressReportCount: validProgress.length,
    elapsedDays,
    progressChange,
    progressRatePerDay,
    checks,
    reasons,
    engineVersion: TEMPORAL_ENGINE_VERSION,
    updatedAt: nowIso,
  };
}

// ---------------------------------------------------------------------------
// I/O wrapper
// ---------------------------------------------------------------------------

export async function computeTemporalAnalysis(project: ProjectRow): Promise<TemporalAnalysisResult> {
  const [progressRows, financialRows, imageRows] = await Promise.all([
    db.select().from(progressRecordsTable).where(eq(progressRecordsTable.projectId, project.id)),
    db.select().from(financialRecordsTable).where(eq(financialRecordsTable.projectId, project.id)),
    db.select().from(evidenceImagesTable).where(eq(evidenceImagesTable.projectId, project.id)),
  ]);

  const rawProgress: RawProgressRecord[] = progressRows.map((r) => ({ id: r.id, reportDate: r.reportDate, progressPercent: r.progressPercent }));
  const rawFinancial: RawFinancialEvent[] = financialRows.map((r) => ({ id: r.id, type: r.type, recordedDate: r.recordedDate, amount: r.amount }));
  const rawImages: RawImageEvent[] = imageRows.map((r) => ({ id: r.id, capturedAt: r.capturedAt }));

  return evaluateTemporalEvidence(
    { startDate: project.startDate, expectedCompletion: project.expectedCompletion, actualCompletion: project.actualCompletion },
    rawProgress,
    rawFinancial,
    rawImages,
  );
}
