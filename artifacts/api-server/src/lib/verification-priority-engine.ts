import type { EvidenceFusionResult } from "./fusion-engine";
import type { CrossModalAnalysisResult, CrossModalInconsistency, EvidenceReference, InconsistencySeverity, SupportingCheck } from "./cross-modal-engine";

// ---------------------------------------------------------------------------
// What this module does
// ---------------------------------------------------------------------------
// Answers "how urgently should a human officer verify this project, based on
// the available evidence?" — NOT "what is the probability this project is
// fraudulent?" It is a pure function of the fusion engine's (P0-J) and the
// cross-modal inconsistency engine's (P0-K) outputs. It never reads
// project.priority, project.id, or anything project-identity-shaped — those
// are exactly the inputs this engine replaces. The human officer remains the
// final decision maker; this only routes attention.
//
// It does NOT compute a second, competing risk score. `drivers.evidenceScore`
// and `drivers.evidenceConfidence` are direct passthroughs of
// fusion.overallEvidenceScore/overallConfidence — this engine only decides
// which LOW/MODERATE/HIGH/CRITICAL bucket those (plus the cross-modal
// severity counts) land in, and explains why in plain language.
//
// P0-M addition: `why` is a structured explainability trail, and `reasons`
// is DERIVED from it (reasons = why.map(w => w.explanation)) rather than
// built in parallel — so every reason string is guaranteed traceable back to
// a concrete why-entry (which itself, for CROSS_MODAL entries, carries the
// underlying evidenceReferences/supportingChecks). No orphaned explanation
// strings. `primaryFinding` is the single most salient evidence-backed
// sentence — it replaces the old fabricated `primaryFlag` seed narrative
// (see worktruth.ts/toProject) and is computed from these SAME why-entries,
// so it can never diverge from what `why`/`reasons` already say.

export const VERIFICATION_PRIORITY_ENGINE_VERSION = "verification-priority-v2";

export type VerificationPriority = "LOW" | "MODERATE" | "HIGH" | "CRITICAL";

export type VerificationPriorityDrivers = {
  evidenceScore: number | null;
  evidenceConfidence: number | null;
  criticalInconsistencies: number;
  highInconsistencies: number;
  moderateInconsistencies: number;
  lowInconsistencies: number;
  availableDimensions: number;
};

// The check→evidence→decision chain (see cross-modal-engine.ts and
// fusion-engine.ts for the earlier links): CROSS_MODAL entries trace to a
// specific P0-K inconsistency (itself traceable to specific engine checks
// and raw evidence IDs — see its own evidenceReferences/supportingChecks).
// FUSION entries trace to a specific anomalous lens's own triggered check.
// EVIDENCE_COVERAGE and INSUFFICIENT_EVIDENCE entries trace to the fusion
// engine's own coverage accounting. Nothing here is generated independently
// of one of those three sources.
export type WhyTrailEntryType = "CROSS_MODAL" | "FUSION" | "EVIDENCE_COVERAGE" | "INSUFFICIENT_EVIDENCE";

export type WhyTrailEntry = {
  type: WhyTrailEntryType;
  title: string;
  explanation: string;
  severity?: InconsistencySeverity;
  confidence?: number;
  evidenceReferences?: EvidenceReference[];
  supportingChecks?: SupportingCheck[];
};

export type VerificationPriorityResult = {
  priority: VerificationPriority;
  // Deliberately NOT priority-derived: this is fusion.overallConfidence,
  // unmodified. A project can be HIGH priority with moderate confidence
  // (the issue may be serious but evidence coverage is limited) or LOW
  // priority with high confidence (multiple streams agree it's clean) —
  // multiplying the two together would erase exactly that distinction.
  confidence: number;
  recommendation: string;
  // The single most salient evidence-backed finding, or an honest
  // statement that no material finding exists / evidence is insufficient.
  // Never fabricated — see derivePrimaryFinding below.
  primaryFinding: string;
  reasons: string[];
  why: WhyTrailEntry[];
  drivers: VerificationPriorityDrivers;
  methodology: string;
  engineVersion: string;
};

export type VerificationPriorityInput = {
  fusion: EvidenceFusionResult;
  inconsistencies: CrossModalAnalysisResult;
};

// ---------------------------------------------------------------------------
// Tunable constants — documented so every routing decision is reproducible
// and explainable. These echo the thresholds already established by the
// engines that feed this one (each engine's own ANOMALY_SCORE_THRESHOLD is
// 0.35; fusion's own STRONG_EVIDENCE_CONFIDENCE is 0.5 and its
// LIMITED_EVIDENCE_WEIGHT_COVERAGE is 0.4) rather than inventing unrelated
// numbers — but are declared independently here since fusion-engine.ts does
// not export its internal constants. MVP heuristics, not statistically
// calibrated coefficients.
// ---------------------------------------------------------------------------

// A fusion evidence score at or above this is "clearly past" every
// individual engine's own 0.35 anomaly threshold — i.e. the combined signal
// is itself squarely anomalous, not just borderline.
const HIGH_EVIDENCE_SCORE_THRESHOLD = 0.5;

// A fusion evidence score at or above this is meaningfully elevated above
// "no anomaly" (0) even though it has not crossed any single engine's own
// 0.35 anomaly threshold — worth a documented review, not urgent routing.
const MODERATE_EVIDENCE_SCORE_THRESHOLD = 0.2;

// Mirrors fusion's own STRONG_EVIDENCE_CONFIDENCE bar — "adequate confidence"
// for a HIGH-priority evidence signal to stand on its own, without requiring
// a corroborating cross-modal inconsistency.
const ADEQUATE_CONFIDENCE_THRESHOLD = 0.5;

// Mirrors fusion's own LIMITED_EVIDENCE_WEIGHT_COVERAGE bar — "meaningful"
// evidence coverage for a MODERATE evidence signal to justify routing on its
// own (below this, too little evidence backs the score to act on it yet).
const MEANINGFUL_COVERAGE_THRESHOLD = 0.4;

// "Multiple HIGH cross-modal inconsistencies" — the count at which HIGH
// findings alone (with no corroborating fusion score) establish a HIGH floor.
const MULTIPLE_HIGH_INCONSISTENCY_COUNT = 2;

// How many inconsistency items of the triggering severity to expand into
// individual why-entries, so the trail stays legible (mirrors fusion's own
// MAX_CROSS_MODAL_REASON_LINES convention).
const MAX_INCONSISTENCY_WHY_ENTRIES = 2;

// How many anomalous lenses to expand into individual FUSION why-entries.
const MAX_ANOMALOUS_LENS_WHY_ENTRIES = 2;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function pluralize(count: number, singular: string, plural: string): string {
  return count === 1 ? singular : plural;
}

function capitalizeWord(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

// A short, human title for each real cross-modal inconsistency `type` string
// (see cross-modal-engine.ts for the canonical list) — every key here is a
// type that engine actually produces. Falls back to a readable
// word-split of the type string rather than a generic label, so a future
// P0-K rule without a matching entry still gets a real (if plainer) title.
const TITLE_BY_INCONSISTENCY_TYPE: Record<string, string> = {
  financial_temporal_activity_before_sanction: "Expenditure recorded before sanction",
  financial_temporal_activity_before_start: "Expenditure recorded before project start",
  financial_temporal_activity_after_completion: "Expenditure recorded after completion",
  geo_visual_reused_image_different_location: "Reused imagery at a different location",
  visual_temporal_no_change_across_dates: "No visual change across dated evidence",
  financial_progress_ratio_mismatch: "Spending and progress mismatch",
  text_category_mismatch: "Description/category mismatch",
};

function titleForInconsistencyType(type: string): string {
  return TITLE_BY_INCONSISTENCY_TYPE[type] ?? type.split("_").map(capitalizeWord).join(" ");
}

// A recommendation keyed to the actual cross-modal inconsistency type that
// triggered routing — never generic "investigate fraud" language. Every key
// here is a real `type` string produced by cross-modal-engine.ts (P0-K); if
// that engine ever adds a rule without a matching entry, `buildRecommendation`
// falls back to a dimension-derived sentence rather than throwing or
// fabricating specifics.
const RECOMMENDATION_BY_INCONSISTENCY_TYPE: Record<string, string> = {
  financial_temporal_activity_before_sanction: "Verify financial records and the sanction timeline first — expenditure was recorded before any known sanction date.",
  financial_temporal_activity_before_start: "Verify financial records against the project's start date.",
  financial_temporal_activity_after_completion: "Verify financial records recorded after the project's completion date.",
  geo_visual_reused_image_different_location: "Verify reused imagery against the declared project location.",
  visual_temporal_no_change_across_dates: "Verify the physical site — submitted evidence images show no visible change across dates.",
  financial_progress_ratio_mismatch: "Review project progress records against expenditure chronology.",
  text_category_mismatch: "Review the project description against its declared category.",
};

function topBySeverity(items: CrossModalInconsistency[], severity: InconsistencySeverity): CrossModalInconsistency[] {
  return items.filter((i) => i.severity === severity).slice(0, MAX_INCONSISTENCY_WHY_ENTRIES);
}

// The most severe inconsistency present, preferring the one the caller is
// currently routing on — used to derive a concrete recommendation sentence.
function mostRelevantInconsistency(items: CrossModalInconsistency[], preferredSeverities: InconsistencySeverity[]): CrossModalInconsistency | null {
  for (const severity of preferredSeverities) {
    const match = items.find((i) => i.severity === severity);
    if (match) return match;
  }
  return null;
}

function buildRecommendation(fusion: EvidenceFusionResult, inconsistencies: CrossModalAnalysisResult, preferredSeverities: InconsistencySeverity[]): string {
  const relevant = mostRelevantInconsistency(inconsistencies.items, preferredSeverities);
  if (relevant) {
    return RECOMMENDATION_BY_INCONSISTENCY_TYPE[relevant.type] ?? `Verify evidence connecting ${relevant.dimensions.map(capitalizeWord).join(" and ")}.`;
  }
  const anomalousLenses = fusion.lenses.filter((l) => l.isAnomalous);
  if (anomalousLenses.length > 0) {
    const labels = anomalousLenses.map((l) => capitalizeWord(l.lens));
    return `Review ${labels.join(" and ")} evidence — ${labels.length === 1 ? "it indicates" : "they indicate"} an anomaly that has not yet been cross-verified against another evidence dimension.`;
  }
  if (fusion.overallEvidenceScore === null) {
    return "Evidence is currently insufficient for a strong assessment; collect additional dated financial, GPS, or progress evidence.";
  }
  return "Evidence is currently consistent; no immediate verification action is required.";
}

// ---------------------------------------------------------------------------
// Why-trail entry builders — each ties directly to one real, already-
// computed fact (a P0-K inconsistency, a specific lens's triggered check, or
// the fusion engine's own coverage accounting). None of these invent a fact.
// ---------------------------------------------------------------------------

function crossModalWhyEntry(item: CrossModalInconsistency): WhyTrailEntry {
  return {
    type: "CROSS_MODAL",
    title: titleForInconsistencyType(item.type),
    explanation: item.description,
    severity: item.severity,
    confidence: item.confidence,
    evidenceReferences: item.evidenceReferences,
    supportingChecks: item.supportingChecks,
  };
}

// Explains WHICH lens is anomalous and WHY (its own triggered check
// message) — never the raw score alone ("Financial score = 0.73").
function anomalousLensWhyEntries(fusion: EvidenceFusionResult): WhyTrailEntry[] {
  return fusion.lenses
    .filter((l) => l.isAnomalous)
    .slice(0, MAX_ANOMALOUS_LENS_WHY_ENTRIES)
    .map((lens) => {
      const check = lens.checks.find((c) => c.severity !== "INFO");
      return {
        type: "FUSION",
        title: `${capitalizeWord(lens.lens)} evidence is anomalous`,
        explanation: check ? `${capitalizeWord(lens.lens)} evidence: ${check.message}` : `${capitalizeWord(lens.lens)} evidence indicates an anomaly.`,
        severity: check?.severity,
        confidence: lens.confidence,
        supportingChecks: check ? [{ lens: lens.lens, checkName: check.name }] : undefined,
      };
    });
}

function coverageWhyEntry(fusion: EvidenceFusionResult): WhyTrailEntry {
  const c = fusion.coverage;
  return {
    type: "EVIDENCE_COVERAGE",
    title: "Meaningful evidence coverage",
    explanation: `Evidence coverage is meaningful — ${c.availableLensCount} of ${c.totalLensCount} dimensions have usable evidence (${Math.round(c.effectiveWeightCoverage * 100)}% of configured weight).`,
  };
}

function insufficientEvidenceWhyEntry(fusion: EvidenceFusionResult): WhyTrailEntry {
  const c = fusion.coverage;
  return {
    type: "INSUFFICIENT_EVIDENCE",
    title: "Insufficient evidence for a strong assessment",
    explanation: `Only ${c.availableLensCount} of ${c.totalLensCount} evidence dimensions contain usable evidence.`,
  };
}

// The single most salient evidence-backed sentence — replaces the old
// fabricated primaryFlag seed narrative. Reuses the exact same evidence the
// why-trail is built from (most severe inconsistency, else the first
// anomalous lens's own triggered check, else an honest "nothing material" or
// "insufficient evidence" statement) — never a fabricated finding.
function derivePrimaryFinding(fusion: EvidenceFusionResult, inconsistencies: CrossModalAnalysisResult): string {
  for (const severity of ["CRITICAL", "HIGH", "MODERATE"] as InconsistencySeverity[]) {
    const match = inconsistencies.items.find((i) => i.severity === severity);
    if (match) return match.description;
  }
  const anomalousLens = fusion.lenses.find((l) => l.isAnomalous);
  if (anomalousLens) {
    const check = anomalousLens.checks.find((c) => c.severity !== "INFO");
    return check ? `${capitalizeWord(anomalousLens.lens)} evidence: ${check.message}` : `${capitalizeWord(anomalousLens.lens)} evidence indicates an anomaly.`;
  }
  if (fusion.overallEvidenceScore === null) {
    return "Insufficient evidence for a material finding; collect additional dated financial, GPS, or progress evidence.";
  }
  return "No material inconsistency identified; evidence is currently consistent.";
}

// ---------------------------------------------------------------------------
// Pure evaluation — no I/O, fully unit-testable with synthetic fixtures.
// ---------------------------------------------------------------------------

export function evaluateVerificationPriority(input: VerificationPriorityInput): VerificationPriorityResult {
  const { fusion, inconsistencies } = input;
  const counts = inconsistencies.countsBySeverity;
  const score = fusion.overallEvidenceScore;
  // Reused unmodified — see the confidence field's own doc comment above.
  const confidence = clamp(fusion.overallConfidence, 0, 1);

  const drivers: VerificationPriorityDrivers = {
    evidenceScore: score,
    evidenceConfidence: fusion.overallConfidence,
    criticalInconsistencies: counts.CRITICAL,
    highInconsistencies: counts.HIGH,
    moderateInconsistencies: counts.MODERATE,
    lowInconsistencies: counts.LOW,
    availableDimensions: fusion.coverage.availableLensCount,
  };

  const primaryFinding = derivePrimaryFinding(fusion, inconsistencies);

  // `reasons` is DERIVED from `why` (never built in parallel) so every
  // reason string is guaranteed traceable to a structured why-entry.
  const finalize = (priority: VerificationPriority, why: WhyTrailEntry[], preferredSeverities: InconsistencySeverity[]): VerificationPriorityResult => ({
    priority,
    confidence,
    recommendation: buildRecommendation(fusion, inconsistencies, preferredSeverities),
    primaryFinding,
    reasons: why.map((w) => w.explanation),
    why,
    drivers,
    methodology:
      "Verification Priority is derived only from the fusion engine's overallEvidenceScore/overallConfidence and the cross-modal inconsistency engine's severity counts — never from project.priority or project identity. " +
      "A CRITICAL cross-modal inconsistency floors priority at CRITICAL. Two or more HIGH inconsistencies, or one HIGH inconsistency alongside a fusion evidence score >= " +
      `${HIGH_EVIDENCE_SCORE_THRESHOLD}, or a fusion score >= ${HIGH_EVIDENCE_SCORE_THRESHOLD} with confidence >= ${ADEQUATE_CONFIDENCE_THRESHOLD} on its own, floors priority at HIGH. ` +
      `A fusion score >= ${MODERATE_EVIDENCE_SCORE_THRESHOLD} with evidence coverage >= ${MEANINGFUL_COVERAGE_THRESHOLD}, or any MODERATE cross-modal inconsistency, floors priority at MODERATE. ` +
      "Otherwise priority is LOW — including when evidence is insufficient, which is reported honestly via low confidence and an explicit reason rather than being treated as an anomaly.",
    engineVersion: VERIFICATION_PRIORITY_ENGINE_VERSION,
  });

  // --- CRITICAL floor: any CRITICAL cross-modal inconsistency ---
  if (counts.CRITICAL > 0) {
    const why: WhyTrailEntry[] = [
      { type: "CROSS_MODAL", title: "Critical cross-evidence inconsistency", explanation: `${counts.CRITICAL} CRITICAL cross-evidence ${pluralize(counts.CRITICAL, "inconsistency", "inconsistencies")} detected.` },
      ...topBySeverity(inconsistencies.items, "CRITICAL").map(crossModalWhyEntry),
    ];
    return finalize("CRITICAL", why, ["CRITICAL"]);
  }

  // --- HIGH floor ---
  const multipleHigh = counts.HIGH >= MULTIPLE_HIGH_INCONSISTENCY_COUNT;
  const highWithElevatedScore = counts.HIGH >= 1 && score !== null && score >= HIGH_EVIDENCE_SCORE_THRESHOLD;
  const strongEvidenceAlone = score !== null && score >= HIGH_EVIDENCE_SCORE_THRESHOLD && confidence >= ADEQUATE_CONFIDENCE_THRESHOLD;
  if (multipleHigh || highWithElevatedScore || strongEvidenceAlone) {
    const why: WhyTrailEntry[] = [];
    if (multipleHigh) {
      why.push({ type: "CROSS_MODAL", title: "Multiple high-severity cross-evidence inconsistencies", explanation: `${counts.HIGH} HIGH cross-evidence inconsistencies detected.` });
    } else if (counts.HIGH >= 1) {
      why.push({
        type: "CROSS_MODAL",
        title: "High-severity cross-evidence inconsistency with elevated evidence",
        explanation: `${counts.HIGH} HIGH cross-evidence ${pluralize(counts.HIGH, "inconsistency", "inconsistencies")} detected alongside an elevated fusion evidence signal.`,
      });
    }
    if (strongEvidenceAlone) {
      why.push({
        type: "FUSION",
        title: "Elevated fusion evidence signal",
        explanation: `Fusion evidence signal is elevated (${Math.round((score as number) * 100)}%) with adequate confidence (${Math.round(confidence * 100)}%).`,
        confidence,
      });
      why.push(...anomalousLensWhyEntries(fusion));
    }
    why.push(...topBySeverity(inconsistencies.items, "HIGH").map(crossModalWhyEntry));
    return finalize("HIGH", why, ["HIGH", "CRITICAL"]);
  }

  // --- MODERATE floor ---
  const moderateEvidenceSignal = score !== null && score >= MODERATE_EVIDENCE_SCORE_THRESHOLD && fusion.coverage.effectiveWeightCoverage >= MEANINGFUL_COVERAGE_THRESHOLD;
  const meaningfulModerateInconsistencies = counts.MODERATE >= 1;
  if (moderateEvidenceSignal || meaningfulModerateInconsistencies) {
    const why: WhyTrailEntry[] = [];
    if (moderateEvidenceSignal) {
      why.push({ type: "FUSION", title: "Moderate fusion evidence signal", explanation: `Fusion evidence signal is moderate (${Math.round((score as number) * 100)}%).`, confidence });
      why.push(coverageWhyEntry(fusion));
      why.push(...anomalousLensWhyEntries(fusion));
    }
    if (meaningfulModerateInconsistencies) {
      why.push({ type: "CROSS_MODAL", title: "Moderate cross-evidence inconsistency", explanation: `${counts.MODERATE} MODERATE cross-evidence ${pluralize(counts.MODERATE, "inconsistency", "inconsistencies")} detected.` });
    }
    why.push(...topBySeverity(inconsistencies.items, "MODERATE").map(crossModalWhyEntry));
    return finalize("MODERATE", why, ["MODERATE", "HIGH", "CRITICAL"]);
  }

  // --- LOW (default): consistent evidence, or genuinely not enough evidence
  // to justify urgent routing. These two cases are NOT the same thing, and
  // are distinguished via confidence/reasons/recommendation, never by
  // inventing a different priority bucket for "unknown."
  const why: WhyTrailEntry[] =
    score === null
      ? [insufficientEvidenceWhyEntry(fusion)]
      : [{ type: "FUSION", title: "Evidence signal is low", explanation: `Evidence signal is low (${Math.round(score * 100)}%) and no material cross-evidence inconsistencies were found.`, confidence }];
  if (counts.LOW > 0) {
    why.push({
      type: "CROSS_MODAL",
      title: "Low-severity cross-evidence findings noted",
      explanation: `${counts.LOW} LOW-severity cross-evidence ${pluralize(counts.LOW, "inconsistency", "inconsistencies")} noted for context; not material to routing.`,
    });
  }
  return finalize("LOW", why, ["LOW", "MODERATE", "HIGH", "CRITICAL"]);
}
