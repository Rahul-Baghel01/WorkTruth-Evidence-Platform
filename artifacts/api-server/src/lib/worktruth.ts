import { count, desc, eq } from "drizzle-orm";
import { Jimp, JimpMime } from "jimp";
import { db } from "@workspace/db";
import {
  analysisRunsTable,
  evidenceImagesTable,
  financialRecordsTable,
  investigationNotesTable,
  investigationsTable,
  progressRecordsTable,
  projectAnalysesTable,
  projectsTable,
  usersTable,
  type ProjectRow,
} from "@workspace/db";
import { hashPassword, normalizeEmail, resolveSeedPasswordAction } from "./auth";
import { computeFinancialAnalysis } from "./financial-engine";
import { computeGeoAnalysis } from "./geo-engine";
import { computeTemporalAnalysis } from "./temporal-engine";
import { computeTextAnalysis } from "./text-engine";
import { computeVisualAnalysis } from "./visual-engine";
import { computeCrossModalInconsistencies } from "./cross-modal-engine";
import { DEFAULT_LENS_WEIGHTS, evaluateEvidenceFusion, type EvidenceFusionResult, type LensName } from "./fusion-engine";
import { evaluateVerificationPriority } from "./verification-priority-engine";
import { extractImageMetadata, sha256Hex } from "./image-processing";
import { evidenceStorage } from "./storage";

const LENS_DISPLAY_LABEL: Record<LensName, string> = {
  financial: "Financial",
  visual: "Visual",
  geospatial: "Geographic",
  temporal: "Temporal",
  text: "Text",
};

// The `risk.components` (SignalScore[]) breakdown shown on the detail page's
// Verification Priority card. Two DISTINCT per-lens numbers, deliberately
// kept separate:
//   - `score`        : the lens's own 0-1 anomaly score, exactly as its
//                      engine produced it and exactly what the "Five lenses"
//                      cards show. Not weighted, not confidence-adjusted.
//   - `contribution` : how many points (out of 100) this lens actually added
//                      to the fusion verification signal — its score times
//                      the SAME confidence-adjusted, renormalized weight the
//                      fusion engine applied (lens.effectiveWeight). The
//                      available lenses' contributions therefore sum to
//                      fusion.overallEvidenceScore * 100 (before the
//                      cross-lens agreement bonus, which is not attributable
//                      to any single lens).
// `weight` is the fixed configured weight, surfaced only to show the scheme.
// A near-zero `score` (a clean lens) yields a near-zero `contribution` — the
// two are never the same metric and are not expected to match.
export function toSignalComponents(fusion: EvidenceFusionResult) {
  return fusion.lenses.map((lens) => ({
    label: LENS_DISPLAY_LABEL[lens.lens],
    score: lens.score ?? 0,
    weight: fusion.weights[lens.lens],
    contribution: (lens.score ?? 0) * lens.effectiveWeight * 100,
    evidenceSufficient: !lens.isInsufficientEvidence,
  }));
}

const baseProjects = [
  ["P-1089", "Construction of Community Hall at Village X", "Community Hall", "Kanpur Nagar", "Uttar Pradesh", 2700000, 2680000, 100, 82, "HIGH", "High cost + similar photograph", 26.4499, 80.3319, "2024-01-15", "2024-07-15", "Village X, Kanpur", "BuildWell Infrastructure"],
  ["P-2041", "Upgradation of Primary School at Bithoor", "School", "Kanpur Nagar", "Uttar Pradesh", 1850000, 1710000, 88, 94, "LOW", "No anomaly detected", 26.6067, 80.2707, "2024-02-01", "2024-09-30", "Bithoor, Kanpur", "Shiksha Works"],
  ["P-3022", "Development of Public Community Centre at Village X", "Community Hall", "Kanpur Nagar", "Uttar Pradesh", 2250000, 2140000, 72, 78, "MODERATE", "Similar project description", 26.4531, 80.3401, "2024-03-12", "2024-11-30", "Village X, Kanpur", "Jan Sewa Projects"],
  ["P-4150", "Improvement of rural access road near Chaubepur", "Road", "Kanpur Dehat", "Uttar Pradesh", 3200000, 3060000, 100, 69, "HIGH", "GPS mismatch + visual reuse", 26.5052, 80.1453, "2023-11-10", "2024-05-30", "Chaubepur, Kanpur Dehat", "Rural Connect LLP"],
  ["P-1007", "Solar drinking water unit at Bidhnu", "Water", "Kanpur Nagar", "Uttar Pradesh", 920000, 840000, 100, 91, "LOW", "No anomaly detected", 26.3479, 80.2764, "2024-01-20", "2024-06-30", "Bidhnu, Kanpur", "Jal Jeevan Mission"],
  ["P-1182", "Covered drain construction at Kalyanpur", "Sanitation", "Kanpur Nagar", "Uttar Pradesh", 1460000, 1390000, 92, 86, "MODERATE", "Completion evidence missing", 26.5121, 80.2332, "2024-02-18", "2024-08-31", "Kalyanpur, Kanpur", "Nagar Seva Works"],
  ["P-1293", "Community library and reading room", "Public Facility", "Lucknow", "Uttar Pradesh", 2450000, 2320000, 84, 89, "LOW", "No anomaly detected", 26.8467, 80.9462, "2024-01-08", "2024-10-15", "Aliganj, Lucknow", "CivicBuild"],
  ["P-1416", "Village approach road resurfacing", "Road", "Unnao", "Uttar Pradesh", 4100000, 3990000, 64, 76, "MODERATE", "Progress record incomplete", 26.5471, 80.4877, "2024-04-02", "2024-12-20", "Safipur, Unnao", "State Road Services"],
  ["P-1562", "Girls hostel sanitation block", "Sanitation", "Farrukhabad", "Uttar Pradesh", 1200000, 1180000, 100, 96, "LOW", "No anomaly detected", 27.3919, 79.5805, "2023-12-12", "2024-06-10", "Farrukhabad City", "Nirman Sahayata"],
  ["P-1688", "Minor irrigation canal lining", "Water", "Etawah", "Uttar Pradesh", 2850000, 2800000, 78, 83, "MODERATE", "Expenditure above benchmark", 26.7855, 79.0218, "2024-02-25", "2024-11-15", "Jaswantnagar, Etawah", "Kisan Infra"],
  ["P-1724", "High school science laboratory", "School", "Aurैया", "Uttar Pradesh", 1980000, 1900000, 100, 93, "LOW", "No anomaly detected", 26.4606, 79.5088, "2024-01-05", "2024-07-20", "Auraiya Town", "Shiksha Works"],
  ["P-1895", "Solid waste collection point", "Sanitation", "Kannauj", "Uttar Pradesh", 760000, 720000, 100, 88, "LOW", "No anomaly detected", 27.0552, 79.9184, "2024-03-01", "2024-08-01", "Kannauj City", "Clean Districts"],
  ["P-2135", "Flood protection embankment", "Water", "Fatehpur", "Uttar Pradesh", 5200000, 4980000, 58, 71, "HIGH", "Delayed progress", 25.927, 80.8129, "2024-01-28", "2024-10-31", "Bindki, Fatehpur", "RiverSafe Contractors"],
  ["P-2280", "Public health sub-centre repair", "Public Facility", "Hamirpur", "Uttar Pradesh", 1750000, 1680000, 100, 90, "LOW", "No anomaly detected", 25.955, 80.148, "2023-12-04", "2024-06-15", "Rath, Hamirpur", "HealthBuild"],
  ["P-2414", "Concrete lane and street lighting", "Road", "Jalaun", "Uttar Pradesh", 2300000, 2210000, 93, 80, "MODERATE", "Visual evidence incomplete", 26.1458, 79.3364, "2024-02-14", "2024-09-05", "Orai, Jalaun", "Gram Vikas"],
  ["P-2671", "Anganwadi centre construction", "Public Facility", "Mahoba", "Uttar Pradesh", 1320000, 1270000, 100, 95, "LOW", "No anomaly detected", 25.292, 79.872, "2024-01-12", "2024-07-01", "Mahoba City", "Bal Vikas"],
  ["P-2818", "Rainwater harvesting system", "Water", "Banda", "Uttar Pradesh", 1040000, 1030000, 97, 85, "MODERATE", "GPS metadata absent", 25.475, 80.339, "2024-03-20", "2024-09-10", "Baberu, Banda", "Jal Raksha"],
  ["P-3184", "Panchayat office renovation", "Public Facility", "Prayagraj", "Uttar Pradesh", 1580000, 1510000, 100, 92, "LOW", "No anomaly detected", 25.4358, 81.8463, "2023-11-22", "2024-05-25", "Koraon, Prayagraj", "CivicBuild"],
  ["P-3369", "Primary road culvert replacement", "Road", "Mirzapur", "Uttar Pradesh", 3650000, 3520000, 81, 74, "HIGH", "Cost deviation + delay", 25.146, 82.569, "2024-01-30", "2024-10-10", "Chunar, Mirzapur", "BridgePoint"],
  ["P-3902", "Drinking water pipeline extension", "Water", "Varanasi", "Uttar Pradesh", 2900000, 2750000, 100, 87, "LOW", "No anomaly detected", 25.3176, 82.9739, "2024-02-08", "2024-08-20", "Rohania, Varanasi", "Jal Jeevan Mission"],
] as const;

function projectDescription(name: string) {
  return name;
}

// P0-N integration fix: a project created via the single "Add project" form
// or the CSV/XLSX import pipeline previously carried only its summary
// sanctionAmount/expenditure scalars — financial-engine.ts could only ever
// reach its BASIC evidence tier for such a project, and temporal-engine /
// cross-modal-engine had no dated financial records to check chronology
// against at all, regardless of how much real financial data was imported.
// This seeds the minimal, honest itemized ledger those scalars imply: a
// SANCTION record and (if positive) an EXPENDITURE record, both dated at the
// project's own startDate. That date is a genuinely neutral default (used
// for BOTH records identically) — it doesn't assert any actual chronological
// relationship between them, so it can never spuriously trigger a "dated
// before sanction" check; it simply lets the DETAILED evidence tier and
// downstream engines engage with real amounts instead of being permanently
// stuck at BASIC. Reused by both the single-create and bulk-import routes.
export async function seedFinancialRecordsFromScalars(project: { id: string; sanctionAmount: number; expenditure: number; startDate: string }, source: "manual" | "import" | "seed_demo") {
  const rows: Array<{ projectId: string; type: "SANCTION" | "EXPENDITURE"; amount: number; recordedDate: string; source: "manual" | "import" | "seed_demo" }> = [];
  if (project.sanctionAmount > 0) rows.push({ projectId: project.id, type: "SANCTION", amount: project.sanctionAmount, recordedDate: project.startDate, source });
  if (project.expenditure > 0) rows.push({ projectId: project.id, type: "EXPENDITURE", amount: project.expenditure, recordedDate: project.startDate, source });
  if (rows.length) await db.insert(financialRecordsTable).values(rows);
}

// Deterministic (no Math.random, no wall-clock dependency) dated progress
// reports interpolating from a low percentage up to the project's own
// recorded `progress`, spread across 0/45/90 days from its startDate. Real
// rows the temporal/cross-modal/fusion/verification-priority engines
// actually consume — not analysis output, and not claimed to be anything
// other than synthetic demo data (source: "seed_demo").
async function seedProgressRecordsFromScalar(project: { id: string; progress: number; startDate: string }) {
  const start = new Date(project.startDate);
  const target = Math.max(0, Math.min(100, project.progress));
  const steps: Array<{ offsetDays: number; percent: number }> = [
    { offsetDays: 0, percent: Math.round(target * 0.25) },
    { offsetDays: 45, percent: Math.round(target * 0.6) },
    { offsetDays: 90, percent: target },
  ];
  await db.insert(progressRecordsTable).values(
    steps.map(({ offsetDays, percent }) => ({
      projectId: project.id,
      reportDate: new Date(start.getTime() + offsetDays * 86_400_000).toISOString().slice(0, 10),
      progressPercent: percent,
      note: "",
      source: "seed_demo" as const,
    })),
  );
}

// A small synthetic (in-process generated, not downloaded/redistributed)
// checkerboard image — genuine spatial structure, so its SHA-256 and
// perceptual hash are real computed values from real bytes, exactly like an
// uploaded photo would get (see image-processing.ts). Deterministic: no
// project-specific pixel data, so every call produces byte-identical output.
// Exported so the image-serving route (routes/worktruth.ts) can regenerate
// the exact same bytes on demand if a seed_demo row's stored file is ever
// missing — see that route's own comment for why that happens on Render's
// ephemeral filesystem and why regenerating (rather than 404ing) is honest:
// it reproduces the identical bytes already hashed into that row's sha256/
// perceptualHash at seed time, not a different or fabricated image.
export async function buildSeedEvidenceImageBuffer(): Promise<Buffer> {
  const size = 48;
  const cell = 12;
  const colorA = 0x2244ffff;
  const colorB = 0xffaa33ff;
  const image = new Jimp({ width: size, height: size, color: colorA });
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if ((Math.floor(x / cell) + Math.floor(y / cell)) % 2 === 1) image.setPixelColor(colorB, x, y);
    }
  }
  return image.getBuffer(JimpMime.png);
}

// GPS/capturedAt are seed-authored DB values near the project's own
// declared location (a deterministic small offset, not Math.random) — they
// are not claimed to be EXIF-extracted, the same way the project's own
// latitude/longitude are seed-authored rather than derived from anything.
async function seedEvidenceImage(project: { id: string; latitude: number; longitude: number; startDate: string }, variant: number) {
  const buffer = await buildSeedEvidenceImageBuffer();
  const metadata = await extractImageMetadata(buffer);
  const sha256 = sha256Hex(buffer);
  const storageKey = await evidenceStorage.save(project.id, buffer, "png");
  const offset = (variant % 2 === 0 ? 1 : -1) * 0.0004; // roughly 40-50m — close, not identical
  await db.insert(evidenceImagesTable).values({
    projectId: project.id,
    storageKey,
    originalFilename: `seed-site-photo-${variant}.png`,
    mimeType: "image/png",
    fileSizeBytes: buffer.length,
    width: metadata.width,
    height: metadata.height,
    capturedAt: new Date(project.startDate),
    gpsLatitude: project.latitude + offset,
    gpsLongitude: project.longitude + offset,
    gpsAccuracyMeters: 8,
    perceptualHash: metadata.perceptualHash,
    sha256,
    label: "Seed site photograph",
    source: "seed_demo",
  });
}

export async function buildAnalysis(project: ProjectRow) {
  // Financial (P0-E), Geographic (P0-F), Temporal (P0-G), Text (P0-H),
  // Visual (P0-I), Evidence Fusion (P0-J), the Cross-Modal Inconsistency
  // engine (P0-K), and the Verification Priority engine (P0-L) all have real
  // engines now — every lens score, the structured inconsistencies, the
  // combined evidence signal, and the routed priority below are computed
  // from actual stored evidence. No project-ID branching, no hardcoded
  // scores, and `risk.priority`/`risk.recommendation` are no longer derived
  // from project.priority at all — see verification-priority-engine.ts.
  // project.priority remains on the `projectsTable` row and on the `Project`
  // API type as source/import provenance (see toProject below), but it does
  // not influence anything computed here.
  //
  // Pipeline order (deliberately non-circular — see cross-modal-engine.ts's
  // header comment): raw lens outputs -> cross-modal inconsistency -> fusion
  // -> verification priority. Verification priority reads only fusion's and
  // the inconsistency engine's OUTPUTS — it never reads project.priority or
  // project identity, and nothing here reads back from verification
  // priority into fusion, so the pipeline stays a strict one-way chain.
  const financial = await computeFinancialAnalysis(project);
  const geo = await computeGeoAnalysis(project);
  const temporal = await computeTemporalAnalysis(project);
  const text = await computeTextAnalysis(project);
  const visual = await computeVisualAnalysis(project);

  const inconsistencies = await computeCrossModalInconsistencies(project, { financial, geospatial: geo, temporal, text, visual });

  const fusion = evaluateEvidenceFusion({ financial, geospatial: geo, temporal, text, visual }, DEFAULT_LENS_WEIGHTS, inconsistencies.items);

  const verificationPriority = evaluateVerificationPriority({ fusion, inconsistencies });

  const components = toSignalComponents(fusion);

  return {
    status: "Completed",
    risk: {
      score: fusion.overallEvidenceScore ?? 0,
      priority: verificationPriority.priority,
      confidence: verificationPriority.confidence,
      // The reasons for THIS routing decision (why this priority), not the
      // fusion engine's own evidence-coverage narrative — that stays
      // available separately via `fusion.reasons` / the Evidence Fusion
      // panel, so the two are never confused with each other.
      reasons: verificationPriority.reasons,
      // Structured explainability (P0-M): every reason above is
      // reasons === why.map(w => w.explanation) — `why` additionally carries
      // each entry's type/severity/confidence/evidenceReferences/
      // supportingChecks so the UI (and any future audit trail) can render
      // the full check -> evidence -> decision chain, not just prose.
      why: verificationPriority.why,
      // The single most salient evidence-backed finding — replaces the old
      // fabricated `primaryFlag` seed narrative entirely (see toProject
      // below). Never fabricated: an honest "no material inconsistency" or
      // "insufficient evidence" statement when nothing stands out.
      primaryFinding: verificationPriority.primaryFinding,
      recommendation: verificationPriority.recommendation,
      weights: fusion.weights,
      components,
      drivers: verificationPriority.drivers,
      methodology: verificationPriority.methodology,
      engineVersion: verificationPriority.engineVersion,
    },
    financial,
    visual,
    text,
    geo,
    temporal,
    fusion,
    inconsistencies,
    updatedAt: new Date().toISOString(),
  };
}

// `Project.priority` in the API is the CURRENT COMPUTED Verification
// Priority (from the project's persisted analysis), never the raw
// `projectsTable.priority` DB column — that column is legacy/import
// provenance (see the schema comment on `projectsTable.priority`) and must
// never override the computed signal (P0-L). `computedPriority` defaults to
// `row.priority` only as a last-resort fallback for a project whose analysis
// has somehow not been computed yet (should not happen in practice — every
// project gets an analysis at creation/seed time) — that fallback path is
// never reached by seeded or normally-created projects, and is not itself a
// substitute for the real computation.
// `Project.primaryFinding` (P0-M) replaces the old fabricated `primaryFlag`
// seed narrative ("High cost + similar photograph", etc.) entirely — it is
// ALWAYS the project's computed analysis.risk.primaryFinding, never the raw
// `projectsTable.primaryFlag` column. That column still exists purely as
// source/import provenance for the seed dataset (see its schema comment)
// and is never read here — there is deliberately no fallback to it, unlike
// `priority`'s defensive fallback, because a fabricated narrative string is
// never an acceptable stand-in for a real finding, even temporarily.
function toProject(row: ProjectRow, computedPriority: string | undefined, primaryFinding: string) {
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    district: row.district,
    state: row.state,
    location: row.location,
    sanctionAmount: row.sanctionAmount,
    expenditure: row.expenditure,
    progress: row.progress,
    evidenceQuality: row.evidenceQuality,
    priority: computedPriority ?? row.priority,
    primaryFinding,
    latitude: row.latitude,
    longitude: row.longitude,
    startDate: row.startDate,
    expectedCompletion: row.expectedCompletion,
    actualCompletion: row.actualCompletion,
  };
}

export { toProject };

// Provisions the one development officer account, but only when the operator
// has explicitly configured it via env vars — never a hardcoded identity or
// password. Runs independently of project seeding below so setting these
// vars after the first boot (once projects already exist) still works.
//
// Idempotent and safe to re-run:
//   - account missing            -> create it
//   - account exists, password   -> rotate ONLY password_hash to a fresh
//     no longer matches             salted scrypt hash of the configured
//                                   password (id, name, role, sessions and
//                                   every other record are left untouched)
//   - account exists, password   -> do nothing
//     already matches
// The configured plaintext is only ever passed to hashPassword/verifyPassword
// and is never stored or logged.
async function ensureSeedUser() {
  const rawEmail = process.env.SEED_OFFICER_EMAIL;
  const password = process.env.SEED_OFFICER_PASSWORD;
  if (!rawEmail || !password) return;
  // Same canonical form the login handler looks up by, so a configured
  // address with stray case/whitespace still resolves to one stable row.
  const email = normalizeEmail(rawEmail);

  const [existing] = await db
    .select({ passwordHash: usersTable.passwordHash })
    .from(usersTable)
    .where(eq(usersTable.email, email));

  const action = await resolveSeedPasswordAction(password, existing?.passwordHash ?? null);
  if (action === "noop") return;

  const passwordHash = await hashPassword(password);
  if (action === "rotate") {
    await db.update(usersTable).set({ passwordHash }).where(eq(usersTable.email, email));
    return;
  }

  const name = process.env.SEED_OFFICER_NAME || "Duty Officer";
  await db.insert(usersTable).values({ email, name, role: "District Monitoring Officer", passwordHash });
}

// Whether the 20-project demo dataset may be auto-created. The officer
// account (ensureSeedUser, above) is always provisioned when configured — it
// is real operator identity, not demo data. The demo PROJECTS are:
//   - seeded in local development (the default), and
//   - seeded when SEED_DEMO_DATA=true is set explicitly,
//   - but NEVER auto-seeded in production otherwise, so a real deployment's
//     database is never silently populated with fabricated projects.
// `pnpm db:seed` respects this too — set SEED_DEMO_DATA=true to force it.
function shouldSeedDemoData(): boolean {
  const flag = process.env.SEED_DEMO_DATA;
  if (flag === "true") return true;
  if (flag === "false") return false;
  return process.env.NODE_ENV !== "production";
}

export async function ensureSeeded() {
  await ensureSeedUser();
  if (!shouldSeedDemoData()) return;
  const [{ value }] = await db.select({ value: count() }).from(projectsTable);
  if (Number(value) > 0) return;
  const projects = baseProjects.map((item) => ({
    id: item[0],
    name: item[1],
    category: item[2],
    district: item[3],
    state: item[4],
    sanctionAmount: item[5],
    expenditure: item[6],
    progress: item[7],
    evidenceQuality: item[8],
    priority: item[9],
    primaryFlag: item[10],
    latitude: item[11],
    longitude: item[12],
    startDate: item[13],
    expectedCompletion: item[14],
    actualCompletion: null,
    location: item[15],
    contractor: item[16],
    description: projectDescription(item[1]),
    source: "seed_demo" as const,
  }));
  await db.insert(projectsTable).values(projects).onConflictDoNothing();
  const rows = await db.select().from(projectsTable);

  // P0-N: give each seed project real financial-ledger and progress-report
  // rows (and, for all but the last two — deliberately left bare so
  // INSUFFICIENT_EVIDENCE stays genuinely demonstrated — a real evidence
  // image too), so the financial/temporal/geo/visual engines and everything
  // downstream of them have actual data to compute from, not just the
  // project's summary scalars. Runs once, guarded by the empty-projects-
  // table check above.
  await Promise.all(
    rows.map(async (project, index) => {
      await seedFinancialRecordsFromScalars(project, "seed_demo");
      await seedProgressRecordsFromScalar(project);
      if (index < rows.length - 2) await seedEvidenceImage(project, index);
    }),
  );

  const analyses = await Promise.all(
    rows.map(async (project) => ({ projectId: project.id, status: "Completed", payload: await buildAnalysis(project) })),
  );
  await db.insert(projectAnalysesTable).values(analyses).onConflictDoNothing();
  await db.insert(analysisRunsTable).values(analyses.map((analysis) => ({ ...analysis, triggeredBy: "seed" })));
  await db.insert(investigationsTable).values(rows.map((project) => ({ projectId: project.id, status: "Pending Review", notes: "", decision: "" }))).onConflictDoNothing();
}

export async function getProject(id: string) {
  await ensureSeeded();
  const [project] = await db.select().from(projectsTable).where(eq(projectsTable.id, id));
  if (!project) return undefined;
  const [analysisRow] = await db.select().from(projectAnalysesTable).where(eq(projectAnalysesTable.projectId, id));
  const [investigation] = await db.select().from(investigationsTable).where(eq(investigationsTable.projectId, id));
  const history = await db.select().from(investigationNotesTable).where(eq(investigationNotesTable.projectId, id)).orderBy(desc(investigationNotesTable.createdAt));
  const analysis = analysisRow
    ? (analysisRow.payload as Awaited<ReturnType<typeof buildAnalysis>>)
    : await buildAnalysis(project);
  return {
    project,
    analysis,
    investigation: {
      status: investigation?.status ?? "Pending Review",
      notes: investigation?.notes ?? "",
      decision: investigation?.decision ?? "",
      history: history.map((item) => ({ id: String(item.id), status: item.status, note: item.note, officer: item.officer, time: item.createdAt.toISOString() })),
    },
  };
}

// Joins each project row with its persisted analysis so callers (dashboard
// stats, the project list/queue, the map) can read the same computed
// Verification Priority and primaryFinding the detail page shows, rather
// than the raw projectsTable.priority/primaryFlag provenance columns — see
// toProject's doc comment.
export async function listProjectRows() {
  await ensureSeeded();
  const rows = await db
    .select({ project: projectsTable, analysisPayload: projectAnalysesTable.payload })
    .from(projectsTable)
    .leftJoin(projectAnalysesTable, eq(projectAnalysesTable.projectId, projectsTable.id))
    .orderBy(desc(projectsTable.evidenceQuality));
  return rows.map(({ project, analysisPayload }) => {
    const analysis = analysisPayload as Awaited<ReturnType<typeof buildAnalysis>> | null;
    return {
      ...project,
      computedPriority: analysis?.risk?.priority ?? project.priority,
      computedPrimaryFinding: analysis?.risk?.primaryFinding ?? "No material inconsistency identified; evidence is currently consistent.",
      lensAnomalies: (analysis?.fusion?.lenses?.filter((lens) => lens.isAnomalous).map((lens) => lens.lens as string) ?? []) as string[],
    };
  });
}

export async function updateInvestigationRecord(id: string, status: string, notes: string, decision: string, actor: { id: number; name: string }) {
  await ensureSeeded();
  await db.update(investigationsTable).set({ status, notes, decision, updatedAt: new Date() }).where(eq(investigationsTable.projectId, id));
  await db.insert(investigationNotesTable).values({ projectId: id, status, note: notes || decision || "Investigation updated", officer: actor.name, userId: actor.id });
  const detail = await getProject(id);
  return detail?.investigation;
}