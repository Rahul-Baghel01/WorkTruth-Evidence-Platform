import type { FinancialAnalysisResult } from "./financial-engine";
import type { GeoAnalysisResult } from "./geo-engine";
import type { TemporalAnalysisResult } from "./temporal-engine";
import type { TextAnalysisResult } from "./text-engine";
import type { VisualAnalysisResult } from "./visual-engine";
// CORRELATED_CHECK_GROUPS lives in cross-modal-engine.ts (P0-K) — it is
// fundamentally cross-modal correlation data, and P0-K's own agreement rule
// (ruleActivityBeforeSanction) needs the identical list. Importing it here
// (rather than duplicating it) keeps ONE source of truth and makes the
// dependency one-directional: fusion depends on cross-modal, never the
// reverse — see cross-modal-engine.ts's header comment for why that
// direction matters (raw lens outputs -> cross-modal -> fusion, no cycle).
import { CORRELATED_CHECK_GROUPS, type CrossModalInconsistency, type InconsistencySeverity } from "./cross-modal-engine";

// ---------------------------------------------------------------------------
// What this module does
// ---------------------------------------------------------------------------
// Combines the five independently-computed evidence lenses into one
// transparent Evidence Fusion result. It consumes each engine's real output
// (imported as types, never reimplemented) — this module does no financial,
// geospatial, temporal, text, or visual calculation of its own. It produces
// a Verification *signal*, not a fraud probability: see EvidenceFusionResult
// below and the product-framing note near overallEvidenceScore.

export const FUSION_ENGINE_VERSION = "fusion-v1";

export type LensName = "financial" | "geospatial" | "temporal" | "text" | "visual";

export type CheckSeverity = "INFO" | "LOW" | "MODERATE" | "HIGH";

export type NormalizedCheck = {
  name: string;
  severity: CheckSeverity;
  message: string;
};

// A common shape every one of the five engines' results is reduced to,
// without discarding their raw output — `raw` below still carries the full
// engine-specific structure (peerGroup, points, etc.) for the API/UI.
export type NormalizedLens = {
  lens: LensName;
  status: string;
  isInsufficientEvidence: boolean;
  isAnomalous: boolean;
  score: number | null;
  confidence: number;
  // The confidence-adjusted, renormalized weight this lens's score is
  // actually multiplied by when evaluateEvidenceFusion computes
  // overallEvidenceScore (0..1, summing to 1 across available lenses; 0 for
  // an unavailable lens or when there is no usable evidence at all).
  // Exposed so a caller can report a per-lens "contribution to the signal"
  // that reconciles with the score itself, instead of recomputing an
  // approximation of it from the raw configured weight.
  effectiveWeight: number;
  checks: NormalizedCheck[];
  reasons: string[];
  engineVersion: string;
};

export type LensWeights = Record<LensName, number>;

// MVP heuristic weights — NOT scientifically calibrated, NOT derived from
// any dataset. Defined in exactly one place so nothing else (API, UI,
// buildAnalysis) hardcodes its own copy. Sums to 1.0.
export const DEFAULT_LENS_WEIGHTS: LensWeights = {
  financial: 0.25,
  geospatial: 0.2,
  temporal: 0.2,
  text: 0.15,
  visual: 0.2,
};

export type EvidenceCoverage = {
  availableLensCount: number;
  totalLensCount: number;
  coveragePercent: number;
  effectiveWeightCoverage: number;
  confidenceAdjustedCoverage: number;
  availableLenses: LensName[];
  unavailableLenses: LensName[];
};

export type AgreementSignal = {
  lenses: LensName[];
  description: string;
};

export type FusionAgreement = {
  agreeingLensCount: number;
  signals: AgreementSignal[];
  bonus: number;
  explanation: string[];
};

export type FusionMixedEvidence = {
  isMixed: boolean;
  anomalousLenses: LensName[];
  consistentLenses: LensName[];
  explanation: string[];
};

export type EvidenceFusionStatus = "INSUFFICIENT_EVIDENCE" | "LIMITED_EVIDENCE" | "SUFFICIENT_EVIDENCE" | "STRONG_EVIDENCE";

// Purely informational passthrough of the cross-modal inconsistency engine's
// (P0-K) output — it never feeds overallEvidenceScore or overallConfidence.
// Those two rely entirely on the per-lens scores/confidences and the
// same-lens agreement mechanism below, exactly as in P0-J. Folding
// inconsistencies into the score as well would double-count findings that
// are often the SAME underlying fact already reflected in a lens's own
// score (e.g. the financial/temporal pre-sanction-spending case) — so this
// summary exists strictly for explanation and UI surfacing, not scoring.
export type FusionCrossModalSummary = {
  count: number;
  countsBySeverity: Record<InconsistencySeverity, number>;
  topInconsistencies: CrossModalInconsistency[];
};

export type EvidenceFusionResult = {
  status: EvidenceFusionStatus;
  // A confidence-weighted evidence signal, bounded [0,1]. This is NOT a
  // probability of fraud and must never be presented as one — it is an
  // input to Verification Priority (P0-L), which remains a routing signal
  // for human officer review.
  overallEvidenceScore: number | null;
  overallConfidence: number;
  coverage: EvidenceCoverage;
  weights: LensWeights;
  lenses: NormalizedLens[];
  agreement: FusionAgreement;
  mixedEvidence: FusionMixedEvidence;
  crossModalSummary: FusionCrossModalSummary;
  reasons: string[];
  engineVersion: string;
  updatedAt: string;
};

export type LensResults = {
  financial: FinancialAnalysisResult;
  geospatial: GeoAnalysisResult;
  temporal: TemporalAnalysisResult;
  text: TextAnalysisResult;
  visual: VisualAnalysisResult;
};

// ---------------------------------------------------------------------------
// Tunable constants — documented so the fusion result is reproducible and
// explainable. These are configurable MVP heuristics, not statistically
// calibrated coefficients.
// ---------------------------------------------------------------------------

// Cross-lens agreement: each additional *independent* anomalous lens beyond
// the first adds this much to the score, capped. Chosen so agreement alone
// can meaningfully move the result without ever letting weak individual
// scores be inflated into a high score purely by lens count.
const AGREEMENT_SCORE_BONUS_PER_EXTRA_LENS = 0.08;
const MAX_AGREEMENT_SCORE_BONUS = 0.2;

// Mirrors the score bonus but for confidence: agreement across independent
// lenses is itself evidence the picture is real, not noise; mixed evidence
// (some lenses anomalous, others consistent) is genuine uncertainty and
// should reduce confidence a little rather than being averaged away.
const AGREEMENT_CONFIDENCE_BONUS_PER_EXTRA_LENS = 0.05;
const MAX_AGREEMENT_CONFIDENCE_BONUS = 0.1;
const MIXED_EVIDENCE_CONFIDENCE_PENALTY = 0.05;

// Evidence-sufficiency status thresholds, on effectiveWeightCoverage (share
// of the configured weight actually backed by available evidence) and
// confidenceAdjustedCoverage (how confident that available evidence is).
const LIMITED_EVIDENCE_WEIGHT_COVERAGE = 0.4;
const STRONG_EVIDENCE_WEIGHT_COVERAGE = 0.75;
const STRONG_EVIDENCE_CONFIDENCE = 0.5;

// Cross-modal inconsistency summary: how many top-severity inconsistencies
// to fold into `reasons` as explicit "Cross-evidence: ..." lines. Kept small
// so the fusion narrative stays legible — the full list is always available
// in the `topInconsistencies` field and via AnalysisBundle.inconsistencies.
const MAX_CROSS_MODAL_REASON_LINES = 3;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

// ---------------------------------------------------------------------------
// Per-lens normalization — maps each engine's real status enum to the
// common isInsufficientEvidence/isAnomalous booleans. This is the only place
// that needs updating if an engine's status vocabulary changes.
// ---------------------------------------------------------------------------

function toChecks(checks: Array<{ name: string; severity: CheckSeverity; message: string }>): NormalizedCheck[] {
  return checks.map((c) => ({ name: c.name, severity: c.severity, message: c.message }));
}

function normalizeFinancial(result: FinancialAnalysisResult): NormalizedLens {
  return {
    lens: "financial",
    status: result.status,
    isInsufficientEvidence: result.status === "INSUFFICIENT_EVIDENCE",
    isAnomalous: result.status === "ANOMALY_DETECTED",
    score: result.score,
    confidence: result.confidence,
    effectiveWeight: 0, // set by evaluateEvidenceFusion once availability + weights are known
    checks: toChecks(result.checks),
    reasons: result.reasons,
    engineVersion: result.engineVersion,
  };
}

function normalizeGeospatial(result: GeoAnalysisResult): NormalizedLens {
  return {
    lens: "geospatial",
    status: result.status,
    isInsufficientEvidence: result.status === "INSUFFICIENT_EVIDENCE",
    isAnomalous: result.status === "LOCATION_ANOMALY",
    score: result.score,
    confidence: result.confidence,
    effectiveWeight: 0, // set by evaluateEvidenceFusion once availability + weights are known
    checks: toChecks(result.checks),
    reasons: result.reasons,
    engineVersion: result.engineVersion,
  };
}

function normalizeTemporal(result: TemporalAnalysisResult): NormalizedLens {
  return {
    lens: "temporal",
    status: result.status,
    isInsufficientEvidence: result.status === "INSUFFICIENT_EVIDENCE",
    isAnomalous: result.status === "TEMPORAL_ANOMALY",
    score: result.score,
    confidence: result.confidence,
    effectiveWeight: 0, // set by evaluateEvidenceFusion once availability + weights are known
    checks: toChecks(result.checks),
    reasons: result.reasons,
    engineVersion: result.engineVersion,
  };
}

function normalizeText(result: TextAnalysisResult): NormalizedLens {
  return {
    lens: "text",
    status: result.status,
    isInsufficientEvidence: result.status === "INSUFFICIENT_EVIDENCE",
    isAnomalous: result.status === "POTENTIALLY_INCONSISTENT" || result.status === "REQUIRES_VERIFICATION",
    score: result.score,
    confidence: result.confidence,
    effectiveWeight: 0, // set by evaluateEvidenceFusion once availability + weights are known
    checks: toChecks(result.checks),
    reasons: result.reasons,
    engineVersion: result.engineVersion,
  };
}

function normalizeVisual(result: VisualAnalysisResult): NormalizedLens {
  return {
    lens: "visual",
    status: result.status,
    isInsufficientEvidence: result.status === "INSUFFICIENT_EVIDENCE",
    isAnomalous: result.status === "REQUIRES_VERIFICATION",
    score: result.score,
    confidence: result.confidence,
    effectiveWeight: 0, // set by evaluateEvidenceFusion once availability + weights are known
    checks: toChecks(result.checks),
    reasons: result.reasons,
    engineVersion: result.engineVersion,
  };
}

// ---------------------------------------------------------------------------
// Cross-lens agreement, with correlated-signal de-duplication
// ---------------------------------------------------------------------------

function computeAgreement(anomalousLenses: NormalizedLens[]): FusionAgreement {
  if (anomalousLenses.length < 2) {
    return { agreeingLensCount: anomalousLenses.length, signals: [], bonus: 0, explanation: [] };
  }

  const groupIndex = new Map<string, number>();
  CORRELATED_CHECK_GROUPS.forEach((group, idx) => {
    for (const member of group) groupIndex.set(`${member.lens}:${member.checkName}`, idx);
  });

  const claimedGroupReporters = new Map<number, LensName[]>();
  const independentLenses: LensName[] = [];

  for (const lens of anomalousLenses) {
    const triggeredNames = lens.checks.filter((c) => c.severity !== "INFO").map((c) => c.name);
    let hasIndependentSignal = false;
    for (const name of triggeredNames) {
      const groupId = groupIndex.get(`${lens.lens}:${name}`);
      if (groupId === undefined) {
        hasIndependentSignal = true;
        continue;
      }
      const reporters = claimedGroupReporters.get(groupId);
      if (reporters) {
        reporters.push(lens.lens);
      } else {
        claimedGroupReporters.set(groupId, [lens.lens]);
        hasIndependentSignal = true; // first lens to report this fact counts as a real signal
      }
    }
    if (hasIndependentSignal) independentLenses.push(lens.lens);
  }

  const signals: AgreementSignal[] = [];
  for (const reporters of claimedGroupReporters.values()) {
    if (reporters.length >= 2) {
      const distinct = [...new Set(reporters)];
      signals.push({
        lenses: distinct,
        description: `${distinct.join(" and ")} independently identified the same underlying timing inconsistency in the financial records (counted once, not twice).`,
      });
    }
  }
  if (independentLenses.length >= 2) {
    signals.push({
      lenses: independentLenses,
      description: `${independentLenses.join(", ")} independently flagged anomalies from unrelated evidence.`,
    });
  }

  const agreeingLensCount = independentLenses.length;
  const bonus = agreeingLensCount >= 2 ? clamp((agreeingLensCount - 1) * AGREEMENT_SCORE_BONUS_PER_EXTRA_LENS, 0, MAX_AGREEMENT_SCORE_BONUS) : 0;

  return { agreeingLensCount, signals, bonus, explanation: signals.map((s) => s.description) };
}

const CROSS_MODAL_SEVERITY_ORDER: InconsistencySeverity[] = ["CRITICAL", "HIGH", "MODERATE", "LOW", "INFO"];

function summarizeCrossModal(inconsistencies: CrossModalInconsistency[]): FusionCrossModalSummary {
  const countsBySeverity: Record<InconsistencySeverity, number> = { INFO: 0, LOW: 0, MODERATE: 0, HIGH: 0, CRITICAL: 0 };
  for (const item of inconsistencies) countsBySeverity[item.severity] += 1;
  const sorted = [...inconsistencies].sort((a, b) => CROSS_MODAL_SEVERITY_ORDER.indexOf(a.severity) - CROSS_MODAL_SEVERITY_ORDER.indexOf(b.severity));
  return { count: inconsistencies.length, countsBySeverity, topInconsistencies: sorted.slice(0, MAX_CROSS_MODAL_REASON_LINES) };
}

function crossModalReasonLines(inconsistencies: CrossModalInconsistency[]): string[] {
  const notable = inconsistencies.filter((i) => i.severity === "HIGH" || i.severity === "CRITICAL").slice(0, MAX_CROSS_MODAL_REASON_LINES);
  return notable.map((i) => `Cross-evidence: ${i.description}`);
}

// ---------------------------------------------------------------------------
// Pure evaluation — no I/O. Takes the five engines' actual results, the
// cross-modal inconsistency engine's output (P0-K — optional, defaults to
// none so this remains callable exactly as it was in P0-J), and optionally
// non-default weights, and returns the fusion result.
// ---------------------------------------------------------------------------

export function evaluateEvidenceFusion(
  lensResults: LensResults,
  weights: LensWeights = DEFAULT_LENS_WEIGHTS,
  inconsistencies: CrossModalInconsistency[] = [],
): EvidenceFusionResult {
  const now = new Date().toISOString();
  const crossModalSummary = summarizeCrossModal(inconsistencies);
  const lenses: NormalizedLens[] = [
    normalizeFinancial(lensResults.financial),
    normalizeGeospatial(lensResults.geospatial),
    normalizeTemporal(lensResults.temporal),
    normalizeText(lensResults.text),
    normalizeVisual(lensResults.visual),
  ];

  const totalLensCount = lenses.length;
  const available = lenses.filter((l) => !l.isInsufficientEvidence);
  const unavailable = lenses.filter((l) => l.isInsufficientEvidence);

  const reasons: string[] = [`${available.length} of ${totalLensCount} evidence dimensions contain sufficient evidence.`];
  for (const lens of unavailable) {
    const detail = lens.reasons[0] ? ` ${lens.reasons[0]}` : "";
    reasons.push(`${capitalize(lens.lens)} evidence is unavailable.${detail}`);
  }

  if (available.length === 0) {
    return {
      status: "INSUFFICIENT_EVIDENCE",
      overallEvidenceScore: null,
      overallConfidence: 0,
      coverage: {
        availableLensCount: 0,
        totalLensCount,
        coveragePercent: 0,
        effectiveWeightCoverage: 0,
        confidenceAdjustedCoverage: 0,
        availableLenses: [],
        unavailableLenses: lenses.map((l) => l.lens),
      },
      weights,
      lenses,
      agreement: { agreeingLensCount: 0, signals: [], bonus: 0, explanation: [] },
      mixedEvidence: { isMixed: false, anomalousLenses: [], consistentLenses: [], explanation: [] },
      crossModalSummary,
      reasons: [...reasons, ...crossModalReasonLines(inconsistencies)],
      engineVersion: FUSION_ENGINE_VERSION,
      updatedAt: now,
    };
  }

  // --- confidence-aware weighted average of available lens scores ---
  // effectiveWeight_i = configuredWeight_i * confidence_i, renormalized
  // across available lenses. Each engine floors its own confidence at 0.1
  // whenever it has any real evidence, so a low-confidence lens contributes
  // less but is never fully silenced by this step alone.
  const effectiveWeights = available.map((l) => weights[l.lens] * l.confidence);
  const totalEffectiveWeight = effectiveWeights.reduce((sum, w) => sum + w, 0);
  const normalizedWeights =
    totalEffectiveWeight > 0 ? effectiveWeights.map((w) => w / totalEffectiveWeight) : available.map(() => 1 / available.length);
  // Record the exact weight each available lens's score is about to be
  // multiplied by, so downstream callers (see worktruth.ts toSignalComponents)
  // can show a per-lens contribution that sums back to the base score.
  available.forEach((lens, i) => {
    lens.effectiveWeight = normalizedWeights[i];
  });
  const baseScore = available.reduce((sum, lens, i) => sum + normalizedWeights[i] * (lens.score ?? 0), 0);

  // --- cross-lens agreement (with correlated-signal de-duplication) ---
  const anomalousAvailable = available.filter((l) => l.isAnomalous);
  const agreement = computeAgreement(anomalousAvailable);
  const overallEvidenceScore = clamp(baseScore + agreement.bonus, 0, 1);

  // --- mixed/contradictory evidence ---
  const consistentAvailable = available.filter((l) => !l.isAnomalous);
  const isMixed = anomalousAvailable.length > 0 && consistentAvailable.length > 0;
  const mixedExplanation = isMixed
    ? [
        `Evidence is mixed: ${anomalousAvailable.map((l) => l.lens).join(", ")} indicate${anomalousAvailable.length === 1 ? "s" : ""} anomalies while ${consistentAvailable.map((l) => l.lens).join(", ")} appear${consistentAvailable.length === 1 ? "s" : ""} consistent.`,
      ]
    : [];
  const mixedEvidence: FusionMixedEvidence = {
    isMixed,
    anomalousLenses: anomalousAvailable.map((l) => l.lens),
    consistentLenses: consistentAvailable.map((l) => l.lens),
    explanation: mixedExplanation,
  };

  // --- coverage ---
  const totalConfiguredWeight = available.reduce((sum, l) => sum + weights[l.lens], 0);
  const confidenceAdjustedCoverage = totalConfiguredWeight > 0 ? available.reduce((sum, l) => sum + weights[l.lens] * l.confidence, 0) / totalConfiguredWeight : 0;
  const coverage: EvidenceCoverage = {
    availableLensCount: available.length,
    totalLensCount,
    coveragePercent: available.length / totalLensCount,
    effectiveWeightCoverage: totalConfiguredWeight,
    confidenceAdjustedCoverage,
    availableLenses: available.map((l) => l.lens),
    unavailableLenses: unavailable.map((l) => l.lens),
  };

  // --- overall confidence ---
  let overallConfidence = confidenceAdjustedCoverage;
  if (agreement.agreeingLensCount >= 2) {
    overallConfidence += clamp((agreement.agreeingLensCount - 1) * AGREEMENT_CONFIDENCE_BONUS_PER_EXTRA_LENS, 0, MAX_AGREEMENT_CONFIDENCE_BONUS);
  }
  if (isMixed) overallConfidence -= MIXED_EVIDENCE_CONFIDENCE_PENALTY;
  overallConfidence = clamp(overallConfidence, 0.1, 0.95);

  // --- evidence-sufficiency status (thresholds documented above; heuristic, not calibrated) ---
  const status: EvidenceFusionStatus =
    coverage.effectiveWeightCoverage < LIMITED_EVIDENCE_WEIGHT_COVERAGE
      ? "LIMITED_EVIDENCE"
      : coverage.effectiveWeightCoverage < STRONG_EVIDENCE_WEIGHT_COVERAGE || confidenceAdjustedCoverage < STRONG_EVIDENCE_CONFIDENCE
        ? "SUFFICIENT_EVIDENCE"
        : "STRONG_EVIDENCE";

  reasons.push(...agreement.explanation, ...mixedEvidence.explanation, ...crossModalReasonLines(inconsistencies));

  return {
    status,
    overallEvidenceScore,
    overallConfidence,
    coverage,
    weights,
    lenses,
    agreement,
    mixedEvidence,
    crossModalSummary,
    reasons,
    engineVersion: FUSION_ENGINE_VERSION,
    updatedAt: now,
  };
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
