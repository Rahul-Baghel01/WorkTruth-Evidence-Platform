import { and, eq, ne } from "drizzle-orm";
import { db, financialRecordsTable, projectsTable, type ProjectRow } from "@workspace/db";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export const FINANCIAL_ENGINE_VERSION = "financial-v1";

export type FinancialCheckSeverity = "INFO" | "LOW" | "MODERATE" | "HIGH";

export type FinancialCheck = {
  name: string;
  severity: FinancialCheckSeverity;
  message: string;
  observed?: Record<string, number>;
  expected?: string;
  supportingRecordIds?: number[];
};

export type FinancialPeerGroup = {
  dimension: string;
  size: number;
  median: number | null;
  mean: number | null;
  standardDeviation: number | null;
  mad: number | null;
  percentileRank: number | null;
  // Absolute-cost benchmark, kept deliberately separate from the fields above
  // (which all describe the expenditure-to-sanction RATIO). Two different
  // questions: "is this project spending its sanction unusually?" versus
  // "is this project's sanction unusually large for work of this kind?".
  /** Median SANCTIONED AMOUNT across the peer group, in rupees. */
  medianSanction: number | null;
  /** This project's sanction divided by `medianSanction`. 2.0 = twice the benchmark. */
  costRatio: number | null;
};

export type FinancialEvidenceLevel = "NONE" | "BASIC" | "DETAILED";
export type FinancialStatus = "INSUFFICIENT_EVIDENCE" | "WITHIN_EXPECTED_RANGE" | "ANOMALY_DETECTED";

export type FinancialAnalysisResult = {
  evidenceLevel: FinancialEvidenceLevel;
  status: FinancialStatus;
  score: number | null;
  confidence: number;
  sanction: number | null;
  expenditure: number | null;
  paymentTotal: number | null;
  expenditureRatio: number | null;
  peerGroup: FinancialPeerGroup;
  checks: FinancialCheck[];
  reasons: string[];
  recordCount: number;
  engineVersion: string;
  updatedAt: string;
};

export type RawFinancialRecord = { id: number; type: string; amount: number; recordedDate: string };

type NormalizedRecord = { id: number; type: "SANCTION" | "EXPENDITURE" | "PAYMENT"; amount: number; recordedDate: string };

// ---------------------------------------------------------------------------
// Tunable constants — documented so the score is reproducible and explainable
// ---------------------------------------------------------------------------

// Minimum peer observations before a robust dispersion measure (MAD/stddev)
// or a percentile rank is considered meaningful. Below this we still report
// the peer count and, when available, a plain median — just not a rank.
const MIN_PEERS_FOR_STATS = 3;

// A peer group below this size is still used, but is called out explicitly
// in the reasons so an officer knows the comparison rests on thin data.
const PEER_COUNT_LOW_CONFIDENCE_THRESHOLD = 5;

// score >= this maps to ANOMALY_DETECTED, otherwise WITHIN_EXPECTED_RANGE.
const ANOMALY_SCORE_THRESHOLD = 0.35;

// Rule-based score component: each triggered (non-INFO) check adds its
// severity weight, capped at 1.
const SEVERITY_WEIGHT: Record<FinancialCheckSeverity, number> = { INFO: 0, LOW: 0.1, MODERATE: 0.25, HIGH: 0.5 };

// Cost-benchmark thresholds: how many times the peer-group MEDIAN SANCTION a
// project's own sanction has to reach before the size of the award itself is
// called out. Deliberately blunt round numbers, and deliberately high — public
// works legitimately vary in scale, so only a large multiple is worth an
// officer's time. Like every other threshold here this is a documented
// heuristic, not a calibrated benchmark.
const COST_RATIO_HIGH_THRESHOLD = 2;
const COST_RATIO_MODERATE_THRESHOLD = 1.5;

// Peer-deviation score component: a robust z-score (MAD-based) of 5 or more
// maps to the maximum component value of 1. 5 MADs is an extreme deviation
// under a normal-ish distribution — chosen to require a genuinely unusual
// gap before the peer signal alone can push the score high.
const PEER_Z_SCORE_SATURATION = 5;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

// ---------------------------------------------------------------------------
// Robust statistics — pure, unit-testable
// ---------------------------------------------------------------------------

export function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function mean(values: number[]): number | null {
  if (!values.length) return null;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

export function standardDeviation(values: number[]): number | null {
  if (values.length < 2) return null;
  const m = mean(values) as number;
  const variance = values.reduce((sum, v) => sum + (v - m) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

// Median Absolute Deviation, scaled by 1.4826 so it estimates the standard
// deviation of a normal distribution — the standard robust alternative to
// stddev when outliers themselves are the thing being detected.
export function mad(values: number[]): number | null {
  const med = median(values);
  if (med === null) return null;
  const deviations = values.map((v) => Math.abs(v - med));
  const rawMad = median(deviations);
  return rawMad === null ? null : rawMad * 1.4826;
}

// Fraction (0-100) of peer values at or below `value`.
export function percentileRank(values: number[], value: number): number | null {
  if (!values.length) return null;
  const countAtOrBelow = values.filter((v) => v <= value).length;
  return (countAtOrBelow / values.length) * 100;
}

// ---------------------------------------------------------------------------
// Record normalization
// ---------------------------------------------------------------------------

function isRecordType(value: string): value is NormalizedRecord["type"] {
  return value === "SANCTION" || value === "EXPENDITURE" || value === "PAYMENT";
}

function normalizeRecords(rows: RawFinancialRecord[]): { valid: NormalizedRecord[]; invalidCount: number } {
  const valid: NormalizedRecord[] = [];
  let invalidCount = 0;
  for (const row of rows) {
    const isValidAmount = Number.isFinite(row.amount) && row.amount > 0;
    const isValidDate = !Number.isNaN(new Date(row.recordedDate).getTime());
    if (!isRecordType(row.type) || !isValidAmount || !isValidDate) {
      invalidCount += 1;
      continue;
    }
    valid.push({ id: row.id, type: row.type, amount: row.amount, recordedDate: row.recordedDate });
  }
  return { valid, invalidCount };
}

function money(amount: number): string {
  return `₹${Math.round(amount).toLocaleString("en-IN")}`;
}

// ---------------------------------------------------------------------------
// Pure evaluation — no I/O, fully unit-testable with synthetic fixtures
// ---------------------------------------------------------------------------

export function evaluateFinancialEvidence(
  project: { sanctionAmount: number; expenditure: number },
  rawRecords: RawFinancialRecord[],
  // `sanctions` (peer sanctioned amounts, for the absolute-cost benchmark) is
  // optional: callers that only have ratios keep working unchanged, and the
  // cost check simply does not run for them.
  peers: { dimension: string; ratios: number[]; sanctions?: number[] },
): FinancialAnalysisResult {
  const { valid: records, invalidCount } = normalizeRecords(rawRecords);
  const checks: FinancialCheck[] = [];
  const now = new Date().toISOString();

  if (invalidCount > 0) {
    checks.push({
      name: "invalid_records_excluded",
      severity: "LOW",
      message: `${invalidCount} financial record${invalidCount === 1 ? "" : "s"} could not be used because of an invalid type, amount, or date.`,
    });
  }

  const hasLedger = records.length > 0;
  const sanctionScalarValid = Number.isFinite(project.sanctionAmount) && project.sanctionAmount > 0;
  const expenditureScalarValid = Number.isFinite(project.expenditure) && project.expenditure >= 0;
  const evidenceLevel: FinancialEvidenceLevel = hasLedger ? "DETAILED" : sanctionScalarValid && expenditureScalarValid ? "BASIC" : "NONE";

  if (evidenceLevel === "NONE") {
    return {
      evidenceLevel,
      status: "INSUFFICIENT_EVIDENCE",
      score: null,
      confidence: 0,
      sanction: sanctionScalarValid ? project.sanctionAmount : null,
      expenditure: expenditureScalarValid ? project.expenditure : null,
      paymentTotal: null,
      expenditureRatio: null,
      peerGroup: { dimension: peers.dimension, size: 0, median: null, mean: null, standardDeviation: null, mad: null, percentileRank: null, medianSanction: null, costRatio: null },
      checks,
      reasons: ["Financial records are incomplete; anomaly assessment could not be completed."],
      recordCount: records.length,
      engineVersion: FINANCIAL_ENGINE_VERSION,
      updatedAt: now,
    };
  }

  let sanction: number;
  let expenditure: number;
  let paymentTotal: number | null = null;

  if (hasLedger) {
    const sanctionRecords = records.filter((r) => r.type === "SANCTION");
    const expenditureRecords = records.filter((r) => r.type === "EXPENDITURE");
    const paymentRecords = records.filter((r) => r.type === "PAYMENT");
    const ledgerSanctionTotal = sanctionRecords.reduce((sum, r) => sum + r.amount, 0);
    const ledgerExpenditureTotal = expenditureRecords.reduce((sum, r) => sum + r.amount, 0);
    paymentTotal = paymentRecords.length ? paymentRecords.reduce((sum, r) => sum + r.amount, 0) : null;

    sanction = sanctionRecords.length ? ledgerSanctionTotal : sanctionScalarValid ? project.sanctionAmount : 0;
    expenditure = expenditureRecords.length ? ledgerExpenditureTotal : expenditureScalarValid ? project.expenditure : 0;

    if (sanctionRecords.length && sanctionScalarValid && Math.abs(ledgerSanctionTotal - project.sanctionAmount) > 1) {
      checks.push({
        name: "sanction_reconciliation",
        severity: "MODERATE",
        message: `Ledger sanction total (${money(ledgerSanctionTotal)}) does not match the project's recorded sanction amount (${money(project.sanctionAmount)}).`,
        observed: { ledgerTotal: ledgerSanctionTotal, recordedAmount: project.sanctionAmount },
        expected: "Ledger sanction total should equal the project's recorded sanction amount",
        supportingRecordIds: sanctionRecords.map((r) => r.id),
      });
    }
    if (expenditureRecords.length && expenditureScalarValid && Math.abs(ledgerExpenditureTotal - project.expenditure) > 1) {
      checks.push({
        name: "expenditure_reconciliation",
        severity: "MODERATE",
        message: `Ledger expenditure total (${money(ledgerExpenditureTotal)}) does not match the project's recorded expenditure (${money(project.expenditure)}).`,
        observed: { ledgerTotal: ledgerExpenditureTotal, recordedAmount: project.expenditure },
        expected: "Ledger expenditure total should equal the project's recorded expenditure",
        supportingRecordIds: expenditureRecords.map((r) => r.id),
      });
    }

    const groups = new Map<string, NormalizedRecord[]>();
    for (const r of records) {
      const key = `${r.type}|${r.amount}|${r.recordedDate}`;
      const list = groups.get(key) ?? [];
      list.push(r);
      groups.set(key, list);
    }
    for (const group of groups.values()) {
      if (group.length > 1) {
        checks.push({
          name: "duplicate_records",
          severity: "HIGH",
          message: `${group.length} identical ${group[0].type.toLowerCase()} records of ${money(group[0].amount)} dated ${group[0].recordedDate} were found — possible duplicate or repeated entry.`,
          observed: { count: group.length, amount: group[0].amount },
          expected: "Each financial event should be recorded once",
          supportingRecordIds: group.map((r) => r.id),
        });
      }
    }

    if (paymentTotal !== null && expenditureRecords.length) {
      if (paymentTotal > ledgerExpenditureTotal * 1.01) {
        checks.push({
          name: "payment_exceeds_expenditure",
          severity: "HIGH",
          message: `Total recorded payments (${money(paymentTotal)}) exceed total recorded expenditure (${money(ledgerExpenditureTotal)}).`,
          observed: { paymentTotal, expenditureTotal: ledgerExpenditureTotal },
          expected: "Payments should not exceed recorded expenditure",
          supportingRecordIds: [...paymentRecords.map((r) => r.id), ...expenditureRecords.map((r) => r.id)],
        });
      } else {
        checks.push({
          name: "payment_expenditure_ratio",
          severity: "INFO",
          message: `Payment total is ${((paymentTotal / ledgerExpenditureTotal) * 100).toFixed(0)}% of recorded expenditure.`,
          observed: { paymentTotal, expenditureTotal: ledgerExpenditureTotal },
        });
      }
    }

    if (paymentRecords.length >= 3 && paymentTotal) {
      const maxPayment = Math.max(...paymentRecords.map((r) => r.amount));
      const share = maxPayment / paymentTotal;
      if (share > 0.8) {
        checks.push({
          name: "payment_concentration",
          severity: "MODERATE",
          message: `A single payment accounts for ${(share * 100).toFixed(0)}% of all recorded payments — unusually concentrated.`,
          observed: { share, maxPayment, paymentTotal },
          expected: "Payments are typically distributed across multiple installments",
          supportingRecordIds: paymentRecords.map((r) => r.id),
        });
      }
    }

    if (sanctionRecords.length) {
      const earliestSanction = sanctionRecords.reduce((min, r) => (r.recordedDate < min ? r.recordedDate : min), sanctionRecords[0].recordedDate);
      const early = [...expenditureRecords, ...paymentRecords].filter((r) => r.recordedDate < earliestSanction);
      if (early.length) {
        checks.push({
          name: "expenditure_before_sanction",
          severity: "HIGH",
          message: `${early.length} expenditure/payment record${early.length === 1 ? "" : "s"} are dated before the earliest recorded sanction (${earliestSanction}) — an impossible chronology.`,
          observed: { count: early.length },
          expected: "Expenditure and payments should occur on or after the sanction date",
          supportingRecordIds: early.map((r) => r.id),
        });
      }
    }
  } else {
    sanction = project.sanctionAmount;
    expenditure = project.expenditure;
    checks.push({
      name: "ledger_unavailable",
      severity: "INFO",
      message: "No itemized financial ledger (sanction/expenditure/payment records) is available for this project — only the summary sanction and expenditure amounts. Payment reconciliation, duplicate detection, and timing checks could not be performed.",
    });
  }

  const expenditureRatio = sanction > 0 ? expenditure / sanction : null;
  if (expenditureRatio === null) {
    checks.push({
      name: "invalid_sanction_amount",
      severity: "HIGH",
      message: "The sanctioned amount is zero or negative, so expenditure could not be compared against it.",
    });
  } else if (expenditure > sanction) {
    const overPercent = (expenditure / sanction - 1) * 100;
    checks.push({
      name: "expenditure_exceeds_sanction",
      severity: overPercent > 25 ? "HIGH" : "MODERATE",
      message: `Expenditure exceeds sanctioned amount by ${overPercent.toFixed(0)}% (${money(expenditure - sanction)}).`,
      observed: { sanction, expenditure, overPercent },
      expected: "Expenditure should not exceed the sanctioned amount",
    });
  } else {
    checks.push({
      name: "expenditure_within_sanction",
      severity: "INFO",
      message: `Expenditure (${money(expenditure)}) is within the sanctioned amount (${money(sanction)}).`,
      observed: { sanction, expenditure },
    });
  }

  // Peer benchmarking
  const validRatios = peers.ratios.filter((r) => Number.isFinite(r) && r >= 0);
  const peerMedian = median(validRatios);
  const peerMean = mean(validRatios);
  const sufficientForStats = validRatios.length >= MIN_PEERS_FOR_STATS;
  const peerStdDev = sufficientForStats ? standardDeviation(validRatios) : null;
  const peerMad = sufficientForStats ? mad(validRatios) : null;
  const peerRank = sufficientForStats && expenditureRatio !== null ? percentileRank(validRatios, expenditureRatio) : null;

  // Absolute-cost benchmark: how this project's sanctioned amount compares to
  // what comparable work was sanctioned for. Only computed when the caller
  // supplied peer sanction amounts and there are enough of them to take a
  // meaningful median.
  const validSanctions = (peers.sanctions ?? []).filter((s) => Number.isFinite(s) && s > 0);
  const peerMedianSanction = validSanctions.length >= MIN_PEERS_FOR_STATS ? median(validSanctions) : null;
  const costRatio = peerMedianSanction !== null && peerMedianSanction > 0 && sanction > 0 ? sanction / peerMedianSanction : null;

  const peerGroup: FinancialPeerGroup = {
    dimension: peers.dimension,
    size: validRatios.length,
    median: peerMedian,
    mean: peerMean,
    standardDeviation: peerStdDev,
    mad: peerMad,
    percentileRank: peerRank,
    medianSanction: peerMedianSanction,
    costRatio,
  };

  if (costRatio !== null && peerMedianSanction !== null && costRatio >= COST_RATIO_MODERATE_THRESHOLD) {
    checks.push({
      name: "cost_above_peer_benchmark",
      severity: costRatio >= COST_RATIO_HIGH_THRESHOLD ? "HIGH" : "MODERATE",
      message: `Sanctioned amount (${money(sanction)}) is ${costRatio.toFixed(1)}× the median sanction of ${validSanctions.length} comparable projects (${money(peerMedianSanction)}, ${peers.dimension}).`,
      observed: { sanction, peerMedianSanction, costRatio, peerCount: validSanctions.length },
      expected: `Comparable to the peer median sanction of ${money(peerMedianSanction)}`,
    });
  }

  if (peerRank !== null && expenditureRatio !== null && peerMedian !== null) {
    if (peerRank >= 95) {
      checks.push({
        name: "peer_outlier_high",
        severity: "HIGH",
        message: `Expenditure-to-sanction ratio is the highest among ${peerGroup.size} comparable projects (${peerGroup.dimension}).`,
        observed: { expenditureRatio, peerMedian, percentileRank: peerRank },
        expected: `Consistent with the peer median ratio of ${peerMedian.toFixed(2)}`,
      });
    } else if (peerRank <= 5) {
      checks.push({
        name: "peer_outlier_low",
        severity: "LOW",
        message: `Expenditure-to-sanction ratio is the lowest among ${peerGroup.size} comparable projects (${peerGroup.dimension}) — unusually low reported expenditure relative to sanction.`,
        observed: { expenditureRatio, peerMedian, percentileRank: peerRank },
      });
    }
  }

  // Score: max of a rule-violation component and a peer-deviation component,
  // each independently bounded to [0,1] — see constants above for the exact
  // weights and saturation points.
  const triggered = checks.filter((c) => c.severity !== "INFO");
  const ruleComponent = clamp(triggered.reduce((sum, c) => sum + SEVERITY_WEIGHT[c.severity], 0), 0, 1);
  let peerComponent = 0;
  if (peerMad !== null && peerMad > 0 && peerMedian !== null && expenditureRatio !== null) {
    const robustZ = Math.abs(expenditureRatio - peerMedian) / peerMad;
    peerComponent = clamp(robustZ / PEER_Z_SCORE_SATURATION, 0, 1);
  }
  const score = clamp(Math.max(ruleComponent, peerComponent), 0, 1);
  const status: FinancialStatus = score >= ANOMALY_SCORE_THRESHOLD ? "ANOMALY_DETECTED" : "WITHIN_EXPECTED_RANGE";

  // Confidence is a separate axis from the anomaly score: it reflects how
  // much evidence backs the assessment, not how alarming it is. DETAILED
  // ledger evidence has a higher ceiling than BASIC (scalar-only) evidence;
  // within either tier, a larger peer group raises confidence further.
  const confidence =
    evidenceLevel === "DETAILED"
      ? clamp(0.5 + Math.min(peerGroup.size, 10) * 0.03, 0, 0.95)
      : clamp(0.25 + Math.min(peerGroup.size, 10) * 0.02, 0, 0.55);

  const reasons: string[] = [];
  if (peerGroup.size === 0) {
    reasons.push(`No comparable projects were found for peer benchmarking (${peerGroup.dimension}).`);
  } else if (peerGroup.size < PEER_COUNT_LOW_CONFIDENCE_THRESHOLD) {
    reasons.push(`Only ${peerGroup.size} comparable project${peerGroup.size === 1 ? " was" : "s were"} available for peer comparison (${peerGroup.dimension}).`);
  }
  if (triggered.length) {
    for (const c of triggered) reasons.push(c.message);
  } else {
    reasons.push("No financial anomaly was detected in the available evidence.");
  }

  return {
    evidenceLevel,
    status,
    score,
    confidence,
    sanction,
    expenditure,
    paymentTotal,
    expenditureRatio,
    peerGroup,
    checks,
    reasons,
    recordCount: records.length,
    engineVersion: FINANCIAL_ENGINE_VERSION,
    updatedAt: now,
  };
}

// ---------------------------------------------------------------------------
// I/O wrapper — fetches records/peers from the database, then delegates to
// the pure evaluator above.
// ---------------------------------------------------------------------------

async function fetchPeerRatios(project: ProjectRow): Promise<{ dimension: string; ratios: number[]; sanctions: number[] }> {
  const categoryAndDistrict = await db
    .select({ sanctionAmount: projectsTable.sanctionAmount, expenditure: projectsTable.expenditure })
    .from(projectsTable)
    .where(and(eq(projectsTable.category, project.category), eq(projectsTable.district, project.district), ne(projectsTable.id, project.id)));

  let dimension = "category + district";
  let pool = categoryAndDistrict;
  if (pool.length < MIN_PEERS_FOR_STATS) {
    const categoryOnly = await db
      .select({ sanctionAmount: projectsTable.sanctionAmount, expenditure: projectsTable.expenditure })
      .from(projectsTable)
      .where(and(eq(projectsTable.category, project.category), ne(projectsTable.id, project.id)));
    if (categoryOnly.length > pool.length) {
      pool = categoryOnly;
      dimension = "category";
    }
  }

  const usable = pool.filter((p) => Number.isFinite(p.sanctionAmount) && p.sanctionAmount > 0 && Number.isFinite(p.expenditure));
  const ratios = usable.map((p) => p.expenditure / p.sanctionAmount);
  const sanctions = usable.map((p) => p.sanctionAmount);

  return { dimension, ratios, sanctions };
}

export async function computeFinancialAnalysis(project: ProjectRow): Promise<FinancialAnalysisResult> {
  const rawRecords = await db.select().from(financialRecordsTable).where(eq(financialRecordsTable.projectId, project.id));
  const peers = await fetchPeerRatios(project);
  return evaluateFinancialEvidence(project, rawRecords, peers);
}
