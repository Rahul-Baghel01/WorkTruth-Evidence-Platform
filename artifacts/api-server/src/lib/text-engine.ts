import { and, eq, ne } from "drizzle-orm";
import { db, projectsTable, type ProjectRow } from "@workspace/db";

// ---------------------------------------------------------------------------
// What this actually is
// ---------------------------------------------------------------------------
// No NLP/embedding library exists anywhere in this workspace (confirmed by
// inspection before writing this file), and none is added here. This is a
// deterministic TF-IDF + cosine-similarity baseline over plain tokenized
// text — classic information-retrieval math, not a learned/semantic model.
// It is intentionally labeled that way throughout (method field, reasons)
// rather than described as "AI" or "semantic" NLP.

export const TEXT_ENGINE_VERSION = "text-v1";
export const TEXT_SIMILARITY_METHOD = "TF-IDF cosine similarity (deterministic token statistics, no ML model)";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type TextCheckSeverity = "INFO" | "LOW" | "MODERATE" | "HIGH";

export type TextCheck = {
  name: string;
  severity: TextCheckSeverity;
  message: string;
  observed?: Record<string, number>;
  supportingProjectIds?: string[];
};

export type TextStatus = "INSUFFICIENT_EVIDENCE" | "CONSISTENT" | "POTENTIALLY_INCONSISTENT" | "REQUIRES_VERIFICATION";

export type TextPeerMatch = { projectId: string; similarity: number };

export type TextPeerGroup = {
  dimension: string;
  size: number;
  topMatches: TextPeerMatch[];
  averageSimilarity: number | null;
};

export type TextAnalysisResult = {
  status: TextStatus;
  score: number | null;
  confidence: number;
  descriptionLength: number;
  tokenCount: number;
  categoryKeywordsAvailable: boolean;
  categoryMatchCount: number;
  peerGroup: TextPeerGroup;
  checks: TextCheck[];
  reasons: string[];
  method: string;
  engineVersion: string;
  updatedAt: string;
};

export type RawPeerProject = { id: string; description: string };

// ---------------------------------------------------------------------------
// Tunable constants — documented so the score is reproducible and explainable.
// These are configurable heuristics, not learned/calibrated thresholds.
// ---------------------------------------------------------------------------

const SEVERITY_WEIGHT: Record<TextCheckSeverity, number> = { INFO: 0, LOW: 0.1, MODERATE: 0.25, HIGH: 0.5 };
const ANOMALY_SCORE_THRESHOLD = 0.35;

// A description with fewer meaningful tokens than this is too thin to
// meaningfully judge for category consistency or similarity.
const SHORT_DESCRIPTION_MIN_TOKENS = 4;

// Cosine similarity at/above this is treated as "highly similar" (MODERATE);
// at/above the higher bar it's treated as HIGH — near-certain overlap.
const HIGH_SIMILARITY_THRESHOLD = 0.5;
const VERY_HIGH_SIMILARITY_THRESHOLD = 0.75;

// Peer-group query mirrors the financial engine's approach: same dimension,
// same minimum-sample reasoning.
const MIN_PEERS_FOR_COMPARISON = 3;

// A small, generic, documented heuristic — NOT a learned model, NOT tied to
// any specific project. Maps a category to terms that plausibly appear in a
// genuine description of that category. Extend as new categories appear;
// a category absent from this map is reported as "keywords unavailable",
// never silently treated as a mismatch.
const CATEGORY_KEYWORDS: Record<string, string[]> = {
  "Community Hall": ["hall", "community", "centre", "center", "gathering", "meeting"],
  School: ["school", "classroom", "education", "student", "teaching", "laboratory", "library"],
  Road: ["road", "street", "lane", "highway", "culvert", "bridge", "pavement", "resurfacing", "approach"],
  Water: ["water", "drinking", "pipeline", "well", "irrigation", "canal", "harvesting", "supply"],
  Sanitation: ["sanitation", "drain", "sewage", "toilet", "waste", "hygiene", "sanitary"],
  "Public Facility": ["office", "centre", "center", "facility", "public", "renovation", "repair", "anganwadi", "health"],
};

const STOPWORDS = new Set([
  "a", "an", "the", "of", "at", "in", "on", "for", "and", "to", "is", "was", "were", "with", "near", "by", "from", "this", "that", "it", "as", "be", "are",
]);

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function normalizeText(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

// ---------------------------------------------------------------------------
// Tokenization and TF-IDF — pure, unit-testable
// ---------------------------------------------------------------------------

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((token) => token.length > 1 && !STOPWORDS.has(token));
}

function termFrequencies(tokens: string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const t of tokens) counts.set(t, (counts.get(t) ?? 0) + 1);
  const total = tokens.length;
  const tf = new Map<string, number>();
  for (const [term, count] of counts) tf.set(term, count / total);
  return tf;
}

// Standard smoothed IDF: ln((N+1)/(df+1)) + 1 — avoids division by zero and
// keeps every term's weight positive.
function buildIdf(corpus: string[][]): (term: string) => number {
  const documentFrequency = new Map<string, number>();
  for (const doc of corpus) {
    for (const term of new Set(doc)) {
      documentFrequency.set(term, (documentFrequency.get(term) ?? 0) + 1);
    }
  }
  const N = corpus.length;
  return (term: string) => Math.log((N + 1) / ((documentFrequency.get(term) ?? 0) + 1)) + 1;
}

function tfIdfVector(tokens: string[], idf: (term: string) => number): Map<string, number> {
  const vector = new Map<string, number>();
  for (const [term, freq] of termFrequencies(tokens)) vector.set(term, freq * idf(term));
  return vector;
}

export function cosineSimilarity(a: Map<string, number>, b: Map<string, number>): number {
  let normA = 0;
  let normB = 0;
  for (const w of a.values()) normA += w * w;
  for (const w of b.values()) normB += w * w;
  if (normA === 0 || normB === 0) return 0;
  const [smaller, larger] = a.size <= b.size ? [a, b] : [b, a];
  let dot = 0;
  for (const [term, w] of smaller) {
    const wOther = larger.get(term);
    if (wOther) dot += w * wOther;
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

// ---------------------------------------------------------------------------
// Pure evaluation — no I/O, fully unit-testable with synthetic fixtures
// ---------------------------------------------------------------------------

export function evaluateTextEvidence(
  project: { description: string; category: string },
  peers: RawPeerProject[],
  peerDimension: string,
): TextAnalysisResult {
  const now = new Date().toISOString();
  const checks: TextCheck[] = [];
  const reasons: string[] = [];

  const normalizedDescription = normalizeText(project.description ?? "");
  const descriptionLength = normalizedDescription.length;
  const categoryKeywords = CATEGORY_KEYWORDS[project.category];

  if (!normalizedDescription) {
    return {
      status: "INSUFFICIENT_EVIDENCE",
      score: null,
      confidence: 0,
      descriptionLength: 0,
      tokenCount: 0,
      categoryKeywordsAvailable: Boolean(categoryKeywords),
      categoryMatchCount: 0,
      peerGroup: { dimension: peerDimension, size: 0, topMatches: [], averageSimilarity: null },
      checks: [{ name: "missing_description", severity: "INFO", message: "No project description was available." }],
      reasons: ["No project description was available."],
      method: TEXT_SIMILARITY_METHOD,
      engineVersion: TEXT_ENGINE_VERSION,
      updatedAt: now,
    };
  }

  const tokens = tokenize(normalizedDescription);
  const isShort = tokens.length < SHORT_DESCRIPTION_MIN_TOKENS;
  if (isShort) {
    checks.push({
      name: "short_description",
      severity: "LOW",
      message: `The project description is very short (${tokens.length} meaningful word${tokens.length === 1 ? "" : "s"}), which limits how much can be assessed.`,
      observed: { tokenCount: tokens.length },
    });
  } else {
    reasons.push("Project description contains sufficient textual evidence.");
  }

  // --- category/description consistency (heuristic, documented above) ---
  let categoryMatchCount = 0;
  if (categoryKeywords) {
    const tokenSet = new Set(tokens);
    const lowerDescription = normalizedDescription.toLowerCase();
    categoryMatchCount = categoryKeywords.filter((kw) => tokenSet.has(kw) || lowerDescription.includes(kw)).length;
    if (categoryMatchCount > 0) {
      checks.push({
        name: "category_keyword_match",
        severity: "INFO",
        message: `Description contains ${categoryMatchCount} term${categoryMatchCount === 1 ? "" : "s"} associated with the "${project.category}" category.`,
        observed: { matches: categoryMatchCount },
      });
    } else if (!isShort) {
      checks.push({
        name: "category_keyword_mismatch",
        severity: "LOW",
        message: `Description/category consistency is weak based on the available category indicators for "${project.category}".`,
        observed: { matches: 0 },
      });
    }
  } else {
    checks.push({
      name: "category_keywords_unavailable",
      severity: "INFO",
      message: `No heuristic keyword set is defined for category "${project.category}"; category consistency could not be assessed.`,
    });
  }

  // --- peer similarity via TF-IDF cosine similarity ---
  const peerTokenized = peers
    .map((p) => ({ id: p.id, tokens: tokenize(normalizeText(p.description ?? "")) }))
    .filter((p) => p.tokens.length > 0);
  const corpus = [tokens, ...peerTokenized.map((p) => p.tokens)];
  const idf = buildIdf(corpus);
  const currentVector = tfIdfVector(tokens, idf);

  const similarities: TextPeerMatch[] = peerTokenized
    .map((p) => ({ projectId: p.id, similarity: cosineSimilarity(currentVector, tfIdfVector(p.tokens, idf)) }))
    .sort((a, b) => b.similarity - a.similarity);
  const topMatches = similarities.slice(0, 3);
  const averageSimilarity = similarities.length ? similarities.reduce((sum, s) => sum + s.similarity, 0) / similarities.length : null;
  const peerGroup: TextPeerGroup = { dimension: peerDimension, size: similarities.length, topMatches, averageSimilarity };

  // --- exact and near-duplicate detection ---
  const normalizedLower = normalizedDescription.toLowerCase();
  const exactDuplicates = peers.filter((p) => normalizeText(p.description ?? "").toLowerCase() === normalizedLower);
  if (exactDuplicates.length) {
    checks.push({
      name: "exact_duplicate_description",
      severity: "HIGH",
      message: `Description is identical to ${exactDuplicates.length} other project${exactDuplicates.length === 1 ? "" : "s"} (${exactDuplicates.map((p) => p.id).join(", ")}).`,
      supportingProjectIds: exactDuplicates.map((p) => p.id),
    });
  } else if (topMatches.length && topMatches[0].similarity >= HIGH_SIMILARITY_THRESHOLD) {
    const strongMatches = topMatches.filter((m) => m.similarity >= HIGH_SIMILARITY_THRESHOLD);
    checks.push({
      name: "highly_similar_description",
      severity: topMatches[0].similarity >= VERY_HIGH_SIMILARITY_THRESHOLD ? "HIGH" : "MODERATE",
      message: `Description is highly similar to ${strongMatches.length} comparable project description${strongMatches.length === 1 ? "" : "s"}, most closely ${topMatches[0].projectId} (${Math.round(topMatches[0].similarity * 100)}% similarity).`,
      observed: { similarity: topMatches[0].similarity },
      supportingProjectIds: strongMatches.map((m) => m.projectId),
    });
  }

  if (similarities.length === 0) {
    checks.push({ name: "no_peers_available", severity: "INFO", message: "No comparable peer projects were available for description similarity comparison." });
    reasons.push("No comparable projects were available for peer text comparison.");
  } else if (similarities.length < MIN_PEERS_FOR_COMPARISON) {
    checks.push({
      name: "small_peer_group",
      severity: "INFO",
      message: `Only ${similarities.length} comparable project${similarities.length === 1 ? "" : "s"} were available; peer comparison is limited.`,
    });
    reasons.push(`Only ${similarities.length} comparable project${similarities.length === 1 ? "" : "s"} were available; peer comparison is limited.`);
  }

  reasons.push(`Description similarity was calculated using ${TEXT_SIMILARITY_METHOD} over ${peerGroup.dimension} peer descriptions.`);

  // --- score, status, confidence ---
  const triggered = checks.filter((c) => c.severity !== "INFO");
  const score = clamp(triggered.reduce((sum, c) => sum + SEVERITY_WEIGHT[c.severity], 0), 0, 1);
  const hasDuplicateSignal = checks.some((c) => c.name === "exact_duplicate_description" || c.name === "highly_similar_description");
  const status: TextStatus = score < ANOMALY_SCORE_THRESHOLD ? "CONSISTENT" : hasDuplicateSignal ? "REQUIRES_VERIFICATION" : "POTENTIALLY_INCONSISTENT";

  let confidence = 0.3;
  if (!isShort) confidence += 0.2;
  if (categoryKeywords) confidence += 0.1;
  confidence += Math.min(similarities.length, 5) * 0.06;
  confidence = clamp(confidence, 0.1, 0.95);

  if (triggered.length) {
    for (const c of triggered) if (!reasons.includes(c.message)) reasons.push(c.message);
  } else {
    reasons.push("No text inconsistencies were detected in the available evidence.");
  }

  return {
    status,
    score,
    confidence,
    descriptionLength,
    tokenCount: tokens.length,
    categoryKeywordsAvailable: Boolean(categoryKeywords),
    categoryMatchCount,
    peerGroup,
    checks,
    reasons,
    method: TEXT_SIMILARITY_METHOD,
    engineVersion: TEXT_ENGINE_VERSION,
    updatedAt: now,
  };
}

// ---------------------------------------------------------------------------
// I/O wrapper
// ---------------------------------------------------------------------------

async function fetchPeers(project: ProjectRow): Promise<{ dimension: string; peers: RawPeerProject[] }> {
  const categoryAndDistrict = await db
    .select({ id: projectsTable.id, description: projectsTable.description })
    .from(projectsTable)
    .where(and(eq(projectsTable.category, project.category), eq(projectsTable.district, project.district), ne(projectsTable.id, project.id)));

  let dimension = "category + district";
  let pool = categoryAndDistrict;
  if (pool.length < MIN_PEERS_FOR_COMPARISON) {
    const categoryOnly = await db
      .select({ id: projectsTable.id, description: projectsTable.description })
      .from(projectsTable)
      .where(and(eq(projectsTable.category, project.category), ne(projectsTable.id, project.id)));
    if (categoryOnly.length > pool.length) {
      pool = categoryOnly;
      dimension = "category";
    }
  }

  return { dimension, peers: pool };
}

export async function computeTextAnalysis(project: ProjectRow): Promise<TextAnalysisResult> {
  const { dimension, peers } = await fetchPeers(project);
  return evaluateTextEvidence({ description: project.description, category: project.category }, peers, dimension);
}
