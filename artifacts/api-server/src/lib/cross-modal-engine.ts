import { eq } from "drizzle-orm";
import { db, evidenceImagesTable, financialRecordsTable, progressRecordsTable, type ProjectRow } from "@workspace/db";
import type { FinancialAnalysisResult, RawFinancialRecord } from "./financial-engine";
import { haversineDistanceMeters, type GeoAnalysisResult } from "./geo-engine";
import type { RawProgressRecord, TemporalAnalysisResult } from "./temporal-engine";
import type { TextAnalysisResult } from "./text-engine";
import type { VisualAnalysisResult } from "./visual-engine";

// ---------------------------------------------------------------------------
// What this module does
// ---------------------------------------------------------------------------
// Answers "do independent evidence streams tell a materially inconsistent
// story about this project?" — NOT "did any one engine flag an anomaly."
// Every rule below either (a) requires two engines to have INDEPENDENTLY
// corroborated the same underlying fact, or (b) promotes a single engine's
// check that itself already spans two genuinely distinct evidence types
// (e.g. an image's content-hash vs its capture-date; a financial ledger
// entry vs the project's start-date field) into a structured, evidence-
// referenced object. It never re-derives an anomaly from scratch when an
// existing engine check already computed it correctly — it reuses each
// check's own `supportingRecordIds`/`supportingImageIds` and looks up the
// concrete raw evidence those IDs point to. This module has NO dependency on
// fusion-engine.ts (fusion depends on this module, not the other way
// around) so the pipeline — raw lens outputs -> cross-modal inconsistency ->
// fusion — never becomes circular.
//
// This is deliberately NOT the source of a second, competing risk score.
// See CrossModalAnalysisResult below: it produces `items` (structured
// inconsistency objects) and severity counts, nothing else. If fusion
// chooses to surface these, it does so transparently (see
// fusion-engine.ts's crossModalSummary), never by inventing a second score.

export const INCONSISTENCY_ENGINE_VERSION = "cross-modal-v1";

export type InconsistencyDimension = "financial" | "geospatial" | "temporal" | "text" | "visual" | "category";
export type InconsistencySeverity = "INFO" | "LOW" | "MODERATE" | "HIGH" | "CRITICAL";

export type EvidenceReference = {
  type: "financial_record" | "progress_record" | "evidence_image" | "project_field" | "check";
  id?: number | string;
  label: string;
  value: string | number | null;
};

export type SupportingCheck = { lens: string; checkName: string };

export type CrossModalInconsistency = {
  // Deterministic — built from the rule's type plus the specific evidence
  // IDs involved, never random and never timestamp-dependent, so the same
  // evidence always produces the same id.
  id: string;
  type: string;
  dimensions: InconsistencyDimension[];
  severity: InconsistencySeverity;
  confidence: number;
  description: string;
  evidenceReferences: EvidenceReference[];
  supportingChecks: SupportingCheck[];
  observedValues: Record<string, string | number | null>;
  expectedRelationship: string;
  engineVersion: string;
  createdAt: string;
};

export type CrossModalAnalysisResult = {
  items: CrossModalInconsistency[];
  countsBySeverity: Record<InconsistencySeverity, number>;
  engineVersion: string;
  updatedAt: string;
};

export type RawEvidenceImageDetail = {
  id: number;
  label: string | null;
  gpsLatitude: number | null;
  gpsLongitude: number | null;
  gpsAccuracyMeters: number | null;
  capturedAt: string | Date | null;
  perceptualHash: string | null;
  sha256: string | null;
};

export type CrossModalProject = {
  id: string;
  category: string;
  description: string;
  latitude: number;
  longitude: number;
  startDate: string;
  expectedCompletion: string;
  actualCompletion: string | null;
};

export type CrossModalInput = {
  project: CrossModalProject;
  financial: FinancialAnalysisResult;
  geospatial: GeoAnalysisResult;
  temporal: TemporalAnalysisResult;
  text: TextAnalysisResult;
  visual: VisualAnalysisResult;
  rawFinancialRecords: RawFinancialRecord[];
  rawProgressRecords: RawProgressRecord[];
  rawEvidenceImages: RawEvidenceImageDetail[];
};

// ---------------------------------------------------------------------------
// Cross-lens correlated-check registry. This is the single source of truth
// for "these checks from different engines represent the SAME underlying
// fact, found in the same source data" — used here to build ONE inconsistency
// object instead of two, and imported by fusion-engine.ts for the identical
// reason on the agreement side, so there is exactly one place that knows
// about this correlation. Found by inspection of the five engines' actual
// check names (not guessed): financial-engine's own ledger-ordering check
// and temporal-engine's cross-evidence check both test "is there
// expenditure/payment dated before the earliest sanction record" from the
// same worktruth_financial_records rows.
// ---------------------------------------------------------------------------
export const CORRELATED_CHECK_GROUPS: Array<Array<{ lens: "financial" | "geospatial" | "temporal" | "text" | "visual"; checkName: string }>> = [
  [
    { lens: "financial", checkName: "expenditure_before_sanction" },
    { lens: "temporal", checkName: "financial_before_sanction" },
  ],
];

// ---------------------------------------------------------------------------
// Tunable constants — documented so every inconsistency is reproducible and
// explainable. These are configurable MVP heuristics, not statistically
// calibrated coefficients — flagged explicitly wherever they function as one.
// ---------------------------------------------------------------------------

// Rule A1: pre-sanction spending materiality. Below this share of the
// sanctioned amount, the chronology fault is still real (HIGH) but not
// escalated to CRITICAL — a small clerical pre-dating is less material than
// a large one.
const CRITICAL_PRESANCTION_SHARE = 0.25;

// Rule B1: reused-image/different-location. Reuses geo-engine's own
// "moderate" distance bar so the two engines describe distance the same way.
const GEO_VISUAL_DISTANCE_THRESHOLD_METERS = 200;

// Rule E1: financial-vs-progress ratio mismatch. Explicitly a heuristic —
// there is no empirically calibrated "expected spend at X% progress" curve
// here, only a documented, conservative pair of thresholds.
const HIGH_SPEND_RATIO_THRESHOLD = 0.85;
const LOW_PROGRESS_THRESHOLD_PERCENT = 30;
const LOW_SPEND_RATIO_THRESHOLD = 0.15;
const HIGH_PROGRESS_THRESHOLD_PERCENT = 90;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function money(amount: number): string {
  return `₹${Math.round(amount).toLocaleString("en-IN")}`;
}

function formatDistance(meters: number): string {
  return meters >= 1000 ? `${(meters / 1000).toFixed(1)} km` : `${Math.round(meters)} m`;
}

function parseDate(value: string | Date | null | undefined): Date | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function findCorrelatedCheckNames(lensA: string, lensB: string): { a: string; b: string } | null {
  for (const group of CORRELATED_CHECK_GROUPS) {
    const memberA = group.find((m) => m.lens === lensA);
    const memberB = group.find((m) => m.lens === lensB);
    if (memberA && memberB) return { a: memberA.checkName, b: memberB.checkName };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Rule A1 (Financial <-> Temporal): both engines independently confirmed the
// same "expenditure/payment dated before the earliest sanction record" fact.
// Requires BOTH engines' checks to have fired — this is the "at least two
// logically independent evidence dimensions" case in its strictest form.
// ---------------------------------------------------------------------------
function ruleActivityBeforeSanction(input: CrossModalInput, now: string): CrossModalInconsistency | null {
  const { financial, temporal, rawFinancialRecords } = input;
  if (financial.status === "INSUFFICIENT_EVIDENCE" || temporal.status === "INSUFFICIENT_EVIDENCE") return null;
  const names = findCorrelatedCheckNames("financial", "temporal");
  if (!names) return null;
  const financialCheck = financial.checks.find((c) => c.name === names.a && c.severity !== "INFO");
  const temporalCheck = temporal.checks.find((c) => c.name === names.b && c.severity !== "INFO");
  if (!financialCheck || !temporalCheck) return null;

  const ids = [...new Set([...(financialCheck.supportingRecordIds ?? []), ...(temporalCheck.supportingRecordIds ?? [])])].sort((a, b) => a - b);
  if (!ids.length) return null;
  const recordsById = new Map(rawFinancialRecords.map((r) => [r.id, r]));
  const early = ids.map((id) => recordsById.get(id)).filter((r): r is RawFinancialRecord => Boolean(r));
  if (!early.length) return null;

  const earlyTotal = early.reduce((sum, r) => sum + r.amount, 0);
  const sanctionTotal = rawFinancialRecords.filter((r) => r.type === "SANCTION").reduce((sum, r) => sum + r.amount, 0);
  const shareOfSanction = sanctionTotal > 0 ? earlyTotal / sanctionTotal : null;
  const severity: InconsistencySeverity = shareOfSanction !== null && shareOfSanction >= CRITICAL_PRESANCTION_SHARE ? "CRITICAL" : "HIGH";
  const earliest = early.reduce((min, r) => (r.recordedDate < min.recordedDate ? r : min), early[0]);

  return {
    id: `financial_temporal_activity_before_sanction:${ids.join("-")}`,
    type: "financial_temporal_activity_before_sanction",
    dimensions: ["financial", "temporal"],
    severity,
    // Both engines independently corroborate this — average their own
    // confidence rather than inventing a new number.
    confidence: clamp((financial.confidence + temporal.confidence) / 2, 0.1, 0.95),
    description: `${early.length} expenditure/payment record${early.length === 1 ? "" : "s"} totalling ${money(earlyTotal)} ${early.length === 1 ? "was" : "were"} recorded before any known sanction date — e.g. ${money(earliest.amount)} dated ${earliest.recordedDate}. Financial and temporal analysis independently identified this same chronology fault.`,
    evidenceReferences: [
      ...early.map((r) => ({ type: "financial_record" as const, id: r.id, label: `${r.type} record`, value: `${money(r.amount)} on ${r.recordedDate}` })),
    ],
    supportingChecks: [
      { lens: "financial", checkName: financialCheck.name },
      { lens: "temporal", checkName: temporalCheck.name },
    ],
    observedValues: {
      earlyRecordCount: early.length,
      earlyTotalAmount: earlyTotal,
      ...(shareOfSanction !== null ? { shareOfSanction: Math.round(shareOfSanction * 1000) / 1000 } : {}),
    },
    expectedRelationship: "Expenditure and payment records should be dated on or after the earliest recorded sanction for the same project.",
    engineVersion: INCONSISTENCY_ENGINE_VERSION,
    createdAt: now,
  };
}

// ---------------------------------------------------------------------------
// Rules A2/A3 (Financial <-> Temporal): promote a single temporal-engine
// check that already spans two distinct evidence types — a financial ledger
// entry, and the project's own start/completion date field — into a
// structured object. Not corroborated by financial-engine (it has no notion
// of project dates), so confidence is capped below the two-engine case above.
// ---------------------------------------------------------------------------
function ruleTemporalOnlyFinancialCheck(
  input: CrossModalInput,
  checkName: string,
  type: string,
  expectedRelationship: string,
  now: string,
): CrossModalInconsistency | null {
  const { temporal, rawFinancialRecords } = input;
  if (temporal.status === "INSUFFICIENT_EVIDENCE") return null;
  const check = temporal.checks.find((c) => c.name === checkName && c.severity !== "INFO");
  if (!check || !check.supportingRecordIds?.length) return null;
  const recordsById = new Map(rawFinancialRecords.map((r) => [r.id, r]));
  const records = check.supportingRecordIds.map((id) => recordsById.get(id)).filter((r): r is RawFinancialRecord => Boolean(r));
  if (!records.length) return null;
  const total = records.reduce((sum, r) => sum + r.amount, 0);

  return {
    id: `${type}:${check.supportingRecordIds.join("-")}`,
    type,
    dimensions: ["financial", "temporal"],
    severity: check.severity, // inherit — never amplified beyond what temporal-engine itself found
    confidence: clamp(temporal.confidence, 0.1, 0.9),
    description: check.message,
    evidenceReferences: records.map((r) => ({ type: "financial_record" as const, id: r.id, label: `${r.type} record`, value: `${money(r.amount)} on ${r.recordedDate}` })),
    supportingChecks: [{ lens: "temporal", checkName: check.name }],
    observedValues: { recordCount: records.length, totalAmount: total },
    expectedRelationship,
    engineVersion: INCONSISTENCY_ENGINE_VERSION,
    createdAt: now,
  };
}

// ---------------------------------------------------------------------------
// Rule B1 (Geospatial <-> Visual): a visually identical/near-identical image
// pair (visual-engine's own duplicate detection) whose two images are
// GPS-tagged at materially different locations (geo-engine's own per-image
// points). NEITHER engine computes this alone — visual-engine has no notion
// of GPS, geo-engine has no notion of image content similarity — so this is
// a genuinely new cross-modal comparison, not a promoted single-engine check.
// ---------------------------------------------------------------------------
function ruleReusedImageDifferentLocation(input: CrossModalInput, now: string): CrossModalInconsistency[] {
  const { visual, geospatial } = input;
  if (visual.status === "INSUFFICIENT_EVIDENCE" || geospatial.status === "INSUFFICIENT_EVIDENCE") return [];
  const dupChecks = visual.checks.filter((c) => (c.name === "exact_duplicate_files" || c.name === "near_duplicate_images") && c.supportingImageIds?.length);
  if (!dupChecks.length) return [];
  const pointsById = new Map(geospatial.points.filter((p) => p.hasValidGps).map((p) => [p.imageId, p]));

  const results: CrossModalInconsistency[] = [];
  const seenPairs = new Set<string>();
  for (const check of dupChecks) {
    const ids = check.supportingImageIds as number[];
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const a = pointsById.get(ids[i]);
        const b = pointsById.get(ids[j]);
        if (!a || !b) continue; // need valid GPS on both images to compare
        const pairKey = [a.imageId, b.imageId].sort((x, y) => x - y).join(":");
        if (seenPairs.has(pairKey)) continue;
        const distance = haversineDistanceMeters({ lat: a.latitude as number, lng: a.longitude as number }, { lat: b.latitude as number, lng: b.longitude as number });
        if (distance <= GEO_VISUAL_DISTANCE_THRESHOLD_METERS) continue; // within plausible GPS drift — not an inconsistency
        seenPairs.add(pairKey);
        const isExact = check.name === "exact_duplicate_files";
        results.push({
          id: `geo_visual_reused_image_different_location:${pairKey}`,
          type: "geo_visual_reused_image_different_location",
          dimensions: ["geospatial", "visual"],
          // Byte-identical content at two different places is unambiguous;
          // a near-duplicate (visually similar but not identical) could
          // legitimately be two similar-looking real sites, so it's treated
          // more conservatively.
          severity: isExact ? "HIGH" : "MODERATE",
          confidence: clamp((geospatial.confidence + visual.confidence) / 2, 0.1, 0.9),
          description: `Evidence images ${a.imageId} and ${b.imageId} are ${isExact ? "byte-for-byte identical" : "visually near-identical"} but are GPS-tagged ${formatDistance(distance)} apart.`,
          evidenceReferences: [
            { type: "evidence_image", id: a.imageId, label: "image location", value: `${(a.latitude as number).toFixed(5)}, ${(a.longitude as number).toFixed(5)}` },
            { type: "evidence_image", id: b.imageId, label: "image location", value: `${(b.latitude as number).toFixed(5)}, ${(b.longitude as number).toFixed(5)}` },
          ],
          supportingChecks: [{ lens: "visual", checkName: check.name }],
          observedValues: { distanceMeters: Math.round(distance) },
          expectedRelationship: "Visually identical or near-identical images are expected to be GPS-tagged at the same physical location.",
          engineVersion: INCONSISTENCY_ENGINE_VERSION,
          createdAt: now,
        });
      }
    }
  }
  return results;
}

// ---------------------------------------------------------------------------
// Rule D1 (Visual <-> Temporal): promote visual-engine's own
// no_visual_change_across_dates check (near-identical images captured on
// different dates) into a structured object with the actual dates attached.
// ---------------------------------------------------------------------------
function ruleNoVisualChangeAcrossDates(input: CrossModalInput, now: string): CrossModalInconsistency | null {
  const { visual, rawEvidenceImages } = input;
  if (visual.status === "INSUFFICIENT_EVIDENCE") return null;
  const check = visual.checks.find((c) => c.name === "no_visual_change_across_dates" && c.severity !== "INFO");
  if (!check || !check.supportingImageIds?.length) return null;
  const imagesById = new Map(rawEvidenceImages.map((img) => [img.id, img]));
  const dated = check.supportingImageIds
    .map((id) => imagesById.get(id))
    .filter((img): img is RawEvidenceImageDetail => Boolean(img))
    .map((img) => ({ id: img.id, date: parseDate(img.capturedAt) }))
    .filter((img): img is { id: number; date: Date } => img.date !== null);

  return {
    id: `visual_temporal_no_change_across_dates:${check.supportingImageIds.join("-")}`,
    type: "visual_temporal_no_change_across_dates",
    dimensions: ["visual", "temporal"],
    severity: check.severity,
    confidence: clamp(visual.confidence, 0.1, 0.9),
    description: check.message,
    evidenceReferences: dated.map((d) => ({ type: "evidence_image" as const, id: d.id, label: "capture date", value: isoDay(d.date) })),
    supportingChecks: [{ lens: "visual", checkName: check.name }],
    observedValues: { imageCount: check.supportingImageIds.length },
    expectedRelationship: "Visually distinct evidence is expected for each dated progress event — the same content should not be resubmitted as separate dated evidence.",
    engineVersion: INCONSISTENCY_ENGINE_VERSION,
    createdAt: now,
  };
}

// ---------------------------------------------------------------------------
// Rule E1 (Financial <-> Progress/Temporal): recorded spending share vs the
// latest reported physical progress. Genuinely new comparison — no existing
// engine computes this relationship. Explicitly a documented heuristic, not
// a calibrated benchmark (there is no empirical "expected spend curve").
// ---------------------------------------------------------------------------
function ruleSpendProgressMismatch(input: CrossModalInput, now: string): CrossModalInconsistency | null {
  const { financial, temporal, rawProgressRecords } = input;
  if (financial.status === "INSUFFICIENT_EVIDENCE" || temporal.status === "INSUFFICIENT_EVIDENCE") return null;
  if (financial.expenditureRatio === null) return null;

  const validProgress = rawProgressRecords
    .map((r) => ({ id: r.id, date: parseDate(r.reportDate), percent: r.progressPercent }))
    .filter((r): r is { id: number; date: Date; percent: number } => r.date !== null && Number.isFinite(r.percent) && r.percent >= 0 && r.percent <= 100);
  if (!validProgress.length) return null;
  validProgress.sort((a, b) => a.date.getTime() - b.date.getTime());
  const latest = validProgress[validProgress.length - 1];
  const ratio = financial.expenditureRatio;

  let severity: InconsistencySeverity;
  let description: string;
  let expectedRelationship: string;
  if (ratio >= HIGH_SPEND_RATIO_THRESHOLD && latest.percent <= LOW_PROGRESS_THRESHOLD_PERCENT) {
    severity = "HIGH";
    description = `${Math.round(ratio * 100)}% of the sanctioned amount has been spent, while the latest reported progress is only ${latest.percent}% (reported ${isoDay(latest.date)}).`;
    expectedRelationship = "Heuristic: recorded expenditure share and reported physical progress are expected to move together; a large gap between high spend and low progress is a mismatch worth verifying.";
  } else if (ratio <= LOW_SPEND_RATIO_THRESHOLD && latest.percent >= HIGH_PROGRESS_THRESHOLD_PERCENT) {
    severity = "MODERATE";
    description = `Latest reported progress is ${latest.percent}% (reported ${isoDay(latest.date)}), while only ${Math.round(ratio * 100)}% of the sanctioned amount has been recorded as spent.`;
    expectedRelationship = "Heuristic: high reported progress with very little recorded spending is unusual and may reflect incomplete financial recording rather than a genuine inconsistency.";
  } else {
    return null;
  }

  return {
    id: `financial_progress_ratio_mismatch:${latest.id}`,
    type: "financial_progress_ratio_mismatch",
    dimensions: ["financial", "temporal"],
    // Capped below the two-engine-corroborated case above — this is a
    // heuristic ratio comparison, not a confirmed chronology fault.
    confidence: clamp((financial.confidence + temporal.confidence) / 2, 0.1, 0.8),
    severity,
    description: `${description} This heuristic compares recorded financial activity against reported physical progress and is not a calibrated benchmark.`,
    evidenceReferences: [
      { type: "project_field", label: "expenditureRatio", value: Math.round(ratio * 1000) / 1000 },
      { type: "progress_record", id: latest.id, label: "latest progress report", value: `${latest.percent}% on ${isoDay(latest.date)}` },
    ],
    supportingChecks: [],
    observedValues: { expenditureRatio: ratio, latestProgressPercent: latest.percent },
    expectedRelationship,
    engineVersion: INCONSISTENCY_ENGINE_VERSION,
    createdAt: now,
  };
}

// ---------------------------------------------------------------------------
// Rule F1 (Text <-> Category): promote text-engine's own category/keyword
// mismatch check. Category is structured project data; the description is
// free-text evidence — two genuinely distinct evidence types, even though
// text-engine itself already computes the comparison. Kept at LOW severity
// and dampened confidence: this is a small heuristic keyword list, not a
// semantic assessment, and text-engine's own tests describe it as "a weak
// signal, not fraud" — that framing is preserved here, never amplified.
// ---------------------------------------------------------------------------
function ruleCategoryTextMismatch(input: CrossModalInput, now: string): CrossModalInconsistency | null {
  const { text, project } = input;
  if (text.status === "INSUFFICIENT_EVIDENCE") return null;
  const check = text.checks.find((c) => c.name === "category_keyword_mismatch");
  if (!check) return null;

  return {
    id: `text_category_mismatch:${project.id}`,
    type: "text_category_mismatch",
    dimensions: ["text", "category"],
    severity: "LOW",
    confidence: clamp(text.confidence * 0.7, 0.1, 0.6),
    description: `${check.message} Category is structured project data ("${project.category}"); the description is free-text evidence.`,
    evidenceReferences: [
      { type: "project_field", label: "category", value: project.category },
      { type: "project_field", label: "description", value: project.description },
    ],
    supportingChecks: [{ lens: "text", checkName: check.name }],
    observedValues: { categoryMatchCount: text.categoryMatchCount },
    expectedRelationship: "A project's description is expected to contain at least some terms characteristic of its declared category.",
    engineVersion: INCONSISTENCY_ENGINE_VERSION,
    createdAt: now,
  };
}

// ---------------------------------------------------------------------------
// Rules NOT implemented, deliberately (section C: Geospatial <-> Temporal —
// "geographically anomalous evidence occurring at a suspiciously relevant
// project stage/date"). No field in the current schema reliably identifies
// a project "stage" independent of the progress/financial timelines already
// covered by rules A/E above, and inventing one would be exactly the kind of
// speculative correlation this engine is required to avoid. Left as a future
// capability — see the P0-K report's "Limitations" section.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Pure evaluation — no I/O, fully unit-testable with synthetic fixtures
// ---------------------------------------------------------------------------

export function evaluateCrossModalInconsistencies(input: CrossModalInput): CrossModalAnalysisResult {
  const now = new Date().toISOString();
  const items: CrossModalInconsistency[] = [];

  const a1 = ruleActivityBeforeSanction(input, now);
  if (a1) items.push(a1);

  const a2 = ruleTemporalOnlyFinancialCheck(
    input,
    "financial_before_start",
    "financial_temporal_activity_before_start",
    "Expenditure and payment records are expected to be dated on or after the project's start date.",
    now,
  );
  if (a2) items.push(a2);

  const a3 = ruleTemporalOnlyFinancialCheck(
    input,
    "financial_after_completion",
    "financial_temporal_activity_after_completion",
    "Expenditure and payment records are expected to be dated on or before the project's recorded completion date.",
    now,
  );
  if (a3) items.push(a3);

  items.push(...ruleReusedImageDifferentLocation(input, now));

  const d1 = ruleNoVisualChangeAcrossDates(input, now);
  if (d1) items.push(d1);

  const e1 = ruleSpendProgressMismatch(input, now);
  if (e1) items.push(e1);

  const f1 = ruleCategoryTextMismatch(input, now);
  if (f1) items.push(f1);

  const countsBySeverity: Record<InconsistencySeverity, number> = { INFO: 0, LOW: 0, MODERATE: 0, HIGH: 0, CRITICAL: 0 };
  for (const item of items) countsBySeverity[item.severity] += 1;

  return { items, countsBySeverity, engineVersion: INCONSISTENCY_ENGINE_VERSION, updatedAt: now };
}

// ---------------------------------------------------------------------------
// I/O wrapper — fetches raw records from the database, then delegates to the
// pure evaluator above. Takes the five lens results as a parameter (computed
// once in buildAnalysis) rather than recomputing them here.
// ---------------------------------------------------------------------------

export async function computeCrossModalInconsistencies(
  project: ProjectRow,
  lensResults: {
    financial: FinancialAnalysisResult;
    geospatial: GeoAnalysisResult;
    temporal: TemporalAnalysisResult;
    text: TextAnalysisResult;
    visual: VisualAnalysisResult;
  },
): Promise<CrossModalAnalysisResult> {
  const [financialRows, progressRows, imageRows] = await Promise.all([
    db.select().from(financialRecordsTable).where(eq(financialRecordsTable.projectId, project.id)),
    db.select().from(progressRecordsTable).where(eq(progressRecordsTable.projectId, project.id)),
    db.select().from(evidenceImagesTable).where(eq(evidenceImagesTable.projectId, project.id)),
  ]);

  const input: CrossModalInput = {
    project: {
      id: project.id,
      category: project.category,
      description: project.description,
      latitude: project.latitude,
      longitude: project.longitude,
      startDate: project.startDate,
      expectedCompletion: project.expectedCompletion,
      actualCompletion: project.actualCompletion,
    },
    ...lensResults,
    rawFinancialRecords: financialRows.map((r) => ({ id: r.id, type: r.type, amount: r.amount, recordedDate: r.recordedDate })),
    rawProgressRecords: progressRows.map((r) => ({ id: r.id, reportDate: r.reportDate, progressPercent: r.progressPercent })),
    rawEvidenceImages: imageRows.map((r) => ({
      id: r.id,
      label: r.label,
      gpsLatitude: r.gpsLatitude,
      gpsLongitude: r.gpsLongitude,
      gpsAccuracyMeters: r.gpsAccuracyMeters,
      capturedAt: r.capturedAt,
      perceptualHash: r.perceptualHash,
      sha256: r.sha256,
    })),
  };

  return evaluateCrossModalInconsistencies(input);
}
