import { Router, type IRouter, type Request, type Response } from "express";
import multer from "multer";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@workspace/db";
import { projectsTable, projectAnalysesTable, investigationsTable, analysisRunsTable, importBatchesTable, usersTable, evidenceImagesTable, financialRecordsTable, progressRecordsTable, type EvidenceImageRow } from "@workspace/db";
import {
  AnalyzeProjectParams,
  AnalyzeProjectResponse,
  CreateProgressRecordBody,
  CreateProgressRecordParams,
  CreateProgressRecordResponse,
  CreateProjectBody,
  CreateProjectResponse,
  DeleteProjectImageParams,
  GetDashboardActivityResponse,
  GetDashboardStatsResponse,
  GetFinancialAnalysisResponse,
  GetFusionAnalysisResponse,
  GetGeoAnalysisResponse,
  GetInconsistenciesResponse,
  GetInvestigationParams,
  GetInvestigationResponse,
  GetProjectAnalysisParams,
  GetProjectAnalysisResponse,
  GetProjectImageFileParams,
  GetProjectImageParams,
  GetProjectImageResponse,
  GetProjectParams,
  GetProjectResponse,
  GetProjectRiskResponse,
  GetSessionResponse,
  GetTemporalAnalysisResponse,
  GetTextAnalysisResponse,
  GetVisualAnalysisResponse,
  ListProgressRecordsParams,
  ListProgressRecordsResponse,
  ListProjectImagesParams,
  ListProjectImagesResponse,
  ListProjectsQueryParams,
  ListProjectsResponse,
  LoginBody,
  LoginResponse,
  UpdateInvestigationBody,
  UpdateInvestigationParams,
  UpdateInvestigationResponse,
  UpdateProjectBody,
  UpdateProjectParams,
  UpdateProjectResponse,
  UploadProjectImageParams,
  UploadProjectImageResponse,
  UploadProjectsBody,
  UploadProjectsResponse,
} from "@workspace/api-zod";
import {
  buildAnalysis,
  buildSeedEvidenceImageBuffer,
  ensureSeeded,
  getProject,
  listProjectRows,
  seedFinancialRecordsFromScalars,
  toProject,
  updateInvestigationRecord,
} from "../lib/worktruth";
import { createSession, deleteSession, DUMMY_PASSWORD_HASH, normalizeEmail, SESSION_COOKIE_NAME, sessionCookieOptions, verifyPassword } from "../lib/auth";
import { requireAuth } from "../middlewares/auth";
import { extractImageMetadata, sha256Hex } from "../lib/image-processing";
import { evidenceStorage } from "../lib/storage";

const router: IRouter = Router();

const MAX_IMAGE_BYTES = 10 * 1024 * 1024; // 10MB — generous for phone photos, small enough to keep local dev practical
const MIME_EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

const imageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_IMAGE_BYTES },
  fileFilter: (_req, file, cb) => {
    cb(null, Object.prototype.hasOwnProperty.call(MIME_EXTENSIONS, file.mimetype));
  },
});

function toEvidenceImage(row: EvidenceImageRow) {
  return {
    id: row.id,
    projectId: row.projectId,
    originalFilename: row.originalFilename,
    mimeType: row.mimeType,
    fileSizeBytes: row.fileSizeBytes,
    width: row.width,
    height: row.height,
    capturedAt: row.capturedAt ? row.capturedAt.toISOString() : null,
    gpsLatitude: row.gpsLatitude,
    gpsLongitude: row.gpsLongitude,
    gpsAccuracyMeters: row.gpsAccuracyMeters,
    sha256: row.sha256,
    perceptualHash: row.perceptualHash,
    label: row.label,
    source: row.source,
    uploadedAt: row.uploadedAt.toISOString(),
  };
}

router.post("/auth/login", async (req, res): Promise<void> => {
  // Trim the identifier before schema validation so a pasted address with a
  // stray leading/trailing space isn't rejected as "invalid email" — the
  // value is canonicalised the same way at seed time (see normalizeEmail).
  const body = req.body as Record<string, unknown> | null | undefined;
  const rawBody =
    body && typeof body.email === "string" ? { ...body, email: body.email.trim() } : body;
  const parsed = LoginBody.safeParse(rawBody);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  await ensureSeeded();
  const email = normalizeEmail(parsed.data.email);
  const [user] = await db.select().from(usersTable).where(eq(usersTable.email, email));
  const validPassword = await verifyPassword(parsed.data.password, user?.passwordHash ?? DUMMY_PASSWORD_HASH);
  // A disabled account gets the exact same generic failure as a wrong
  // password — never a distinct "account disabled" message, which would
  // leak account existence/status to an unauthenticated caller.
  if (!user || !validPassword || !user.isActive) {
    res.status(401).json({ error: "Invalid email or password" });
    return;
  }
  const { token, expiresAt } = await createSession(user.id);
  res.cookie(SESSION_COOKIE_NAME, token, { ...sessionCookieOptions(), expires: expiresAt });
  res.json(LoginResponse.parse({
    user: { id: user.id, name: user.name, email: user.email, role: user.role },
  }));
});

router.post("/auth/logout", async (req, res): Promise<void> => {
  const token = req.cookies?.[SESSION_COOKIE_NAME] as string | undefined;
  await deleteSession(token);
  // Same path/sameSite/secure the cookie was set with, so the browser drops it.
  res.clearCookie(SESSION_COOKIE_NAME, sessionCookieOptions());
  res.status(204).end();
});

router.use(requireAuth);

router.get("/auth/session", (req, res): void => {
  res.json(GetSessionResponse.parse({ user: req.user }));
});

// Real per-signal anomaly counts (P0-M) — replaces the old primaryFlag
// keyword-matching + a hardcoded "+4" padding constant with an actual count
// of projects whose persisted fusion result marked that lens anomalous.
const LENS_KEY_BY_SIGNAL_LABEL: Record<string, string> = {
  Financial: "financial",
  Visual: "visual",
  Geographic: "geospatial",
  Temporal: "temporal",
  Text: "text",
};

router.get("/dashboard/stats", async (_req, res): Promise<void> => {
  const rows = await listProjectRows();
  const projects = rows.map((row) => toProject(row, row.computedPriority, row.computedPrimaryFinding));
  const countFor = (priority: string) => projects.filter((project) => project.priority === priority).length;
  const categories = [...new Set(projects.map((project) => project.category))];
  const signalLabels = ["Financial", "Visual", "Geographic", "Temporal", "Text"];
  const stats = {
    totalProjects: projects.length,
    lowRisk: countFor("LOW"),
    moderateRisk: countFor("MODERATE"),
    highRisk: countFor("HIGH"),
    criticalRisk: countFor("CRITICAL"),
    verificationRequired: projects.filter((project) => project.priority === "HIGH" || project.priority === "CRITICAL").length,
    averageEvidenceQuality: Math.round(projects.reduce((sum, project) => sum + project.evidenceQuality, 0) / projects.length),
    riskDistribution: [
      { label: "LOW", value: countFor("LOW") },
      { label: "MODERATE", value: countFor("MODERATE") },
      { label: "HIGH", value: countFor("HIGH") },
      { label: "CRITICAL", value: countFor("CRITICAL") },
    ],
    categoryBreakdown: categories.map((label) => ({ label, value: projects.filter((project) => project.category === label).length })),
    anomalySignals: signalLabels.map((label) => ({ label, value: rows.filter((row) => row.lensAnomalies.includes(LENS_KEY_BY_SIGNAL_LABEL[label])).length })),
    trend: [
      { month: "Jan", low: 2, moderate: 1, high: 0, critical: 0 },
      { month: "Feb", low: 3, moderate: 1, high: 1, critical: 0 },
      { month: "Mar", low: 4, moderate: 2, high: 1, critical: 0 },
      { month: "Apr", low: 5, moderate: 2, high: 2, critical: 0 },
      { month: "May", low: 7, moderate: 3, high: 2, critical: 0 },
      { month: "Jun", low: countFor("LOW"), moderate: countFor("MODERATE"), high: countFor("HIGH"), critical: countFor("CRITICAL") },
    ],
    flaggedProjects: projects.filter((project) => project.priority !== "LOW").slice(0, 5),
  };
  res.json(GetDashboardStatsResponse.parse(stats));
});

function titleCase(value: string): string {
  return value.charAt(0) + value.slice(1).toLowerCase();
}

function relativeTimeLabel(date: Date, now: Date): string {
  const minutes = Math.round((now.getTime() - date.getTime()) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? "Yesterday" : `${days} days ago`;
}

// Real recent-activity feed (P0-M) — derived from analysisRunsTable, the
// append-only record of every analysis run (P0-C). Replaces the old
// hardcoded mock feed, which fabricated specific findings about specific
// real project IDs and presented them as live system activity.
router.get("/dashboard/activity", async (_req, res): Promise<void> => {
  await ensureSeeded();
  const runs = await db.select().from(analysisRunsTable).orderBy(desc(analysisRunsTable.createdAt)).limit(6);
  const now = new Date();
  const activity = runs.map((run) => {
    const payload = run.payload as Awaited<ReturnType<typeof buildAnalysis>>;
    const priority = payload?.risk?.priority ?? "LOW";
    const primaryFinding = payload?.risk?.primaryFinding ?? "Analysis completed.";
    return {
      id: `run-${run.id}`,
      type: priority === "CRITICAL" || priority === "HIGH" ? "risk" : "evidence",
      title: `${titleCase(priority)} verification priority`,
      detail: `${run.projectId}: ${primaryFinding}`,
      time: relativeTimeLabel(run.createdAt, now),
      projectId: run.projectId,
    };
  });
  res.json(GetDashboardActivityResponse.parse(activity));
});

router.get("/projects", async (req, res): Promise<void> => {
  const parsed = ListProjectsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const query = parsed.data;
  let rows = await listProjectRows();
  const search = query.search?.toLowerCase();
  if (search) rows = rows.filter((row) => `${row.id} ${row.name} ${row.location}`.toLowerCase().includes(search));
  // Filtering/sorting by priority uses the computed Verification Priority
  // (P0-L), not the raw projectsTable.priority provenance column — see
  // listProjectRows()/toProject()'s doc comments.
  if (query.priority) rows = rows.filter((row) => row.computedPriority === query.priority);
  if (query.district) rows = rows.filter((row) => row.district === query.district);
  if (query.category) rows = rows.filter((row) => row.category === query.category);
  if (query.sort === "evidence") rows.sort((a, b) => a.evidenceQuality - b.evidenceQuality);
  if (query.sort === "financial") rows.sort((a, b) => b.expenditure / b.sanctionAmount - a.expenditure / a.sanctionAmount);
  if (query.sort === "visual") rows.sort((a, b) => (b.computedPriority === "HIGH" ? 1 : 0) - (a.computedPriority === "HIGH" ? 1 : 0));
  const page = query.page ?? 1;
  const pageSize = query.pageSize ?? 20;
  const all = rows.map((row) => toProject(row, row.computedPriority, row.computedPrimaryFinding));
  const items = all.slice((page - 1) * pageSize, page * pageSize);
  res.json(ListProjectsResponse.parse({
    items,
    total: all.length,
    page,
    pageSize,
    districts: [...new Set((await listProjectRows()).map((row) => row.district))],
    categories: [...new Set((await listProjectRows()).map((row) => row.category))],
  }));
});

router.post("/projects", async (req, res): Promise<void> => {
  const parsed = CreateProjectBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const input = parsed.data;
  const row = {
    ...input,
    location: input.location ?? "Location pending",
    startDate: input.startDate ?? new Date().toISOString().slice(0, 10),
    expectedCompletion: input.expectedCompletion ?? new Date().toISOString().slice(0, 10),
    evidenceQuality: 0,
    priority: "MODERATE",
    primaryFlag: "Insufficient evidence",
    actualCompletion: null,
    contractor: "To be confirmed",
  };
  await ensureSeeded();
  await db.insert(projectsTable).values(row);
  await seedFinancialRecordsFromScalars(row, "manual");
  const freshAnalysis = await buildAnalysis(row as never);
  await db.insert(projectAnalysesTable).values({ projectId: row.id, status: "Queued", payload: freshAnalysis });
  await db.insert(investigationsTable).values({ projectId: row.id, status: "Pending Review", notes: "", decision: "" });
  res.status(201).json(CreateProjectResponse.parse(toProject(row as never, freshAnalysis.risk.priority, freshAnalysis.risk.primaryFinding)));
});

router.get("/projects/:id", async (req, res): Promise<void> => {
  const params = GetProjectParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const detail = await getProject(params.data.id);
  if (!detail) {
    res.status(404).json({ error: "Project not found" });
    return;
  }
  res.json(GetProjectResponse.parse({ ...toProject(detail.project, detail.analysis.risk.priority, detail.analysis.risk.primaryFinding), description: detail.project.description, contractor: detail.project.contractor, analysis: detail.analysis, investigation: detail.investigation }));
});

router.put("/projects/:id", async (req, res): Promise<void> => {
  const params = UpdateProjectParams.safeParse(req.params);
  const body = UpdateProjectBody.safeParse(req.body);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  await db.update(projectsTable).set(body.data).where(eq(projectsTable.id, params.data.id));
  const detail = await getProject(params.data.id);
  if (!detail) {
    res.status(404).json({ error: "Project not found" });
    return;
  }
  res.json(UpdateProjectResponse.parse(toProject(detail.project, detail.analysis.risk.priority, detail.analysis.risk.primaryFinding)));
});

router.get("/projects/:id/analysis", async (req, res): Promise<void> => {
  const params = GetProjectAnalysisParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const detail = await getProject(params.data.id);
  if (!detail) {
    res.status(404).json({ error: "Project not found" });
    return;
  }
  res.json(GetProjectAnalysisResponse.parse(detail.analysis));
});

router.post("/projects/:id/analysis", async (req, res): Promise<void> => {
  const params = AnalyzeProjectParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const detail = await getProject(params.data.id);
  if (!detail) {
    res.status(404).json({ error: "Project not found" });
    return;
  }
  const analysis = await buildAnalysis(detail.project);
  await db.update(projectAnalysesTable).set({ status: "Completed", payload: analysis, updatedAt: new Date() }).where(eq(projectAnalysesTable.projectId, params.data.id));
  await db.insert(analysisRunsTable).values({ projectId: params.data.id, status: "Completed", payload: analysis, triggeredBy: "manual_rerun" });
  res.status(202).json(AnalyzeProjectResponse.parse(analysis));
});

async function component(req: Request, res: Response, key: "risk" | "financial" | "visual" | "text" | "geo" | "temporal") {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const detail = await getProject(id);
  if (!detail) {
    res.status(404).json({ error: "Project not found" });
    return;
  }
  res.json(detail.analysis[key]);
}

router.get("/projects/:id/financial-analysis", async (req, res): Promise<void> => { const p = GetProjectAnalysisParams.safeParse(req.params); if (!p.success) { res.status(400).json({ error: p.error.message }); return; } const detail = await getProject(p.data.id); if (!detail) { res.status(404).json({ error: "Project not found" }); return; } res.json(GetFinancialAnalysisResponse.parse(detail.analysis.financial)); });
router.get("/projects/:id/visual-analysis", async (req, res): Promise<void> => { const p = GetProjectAnalysisParams.safeParse(req.params); if (!p.success) { res.status(400).json({ error: p.error.message }); return; } const detail = await getProject(p.data.id); if (!detail) { res.status(404).json({ error: "Project not found" }); return; } res.json(GetVisualAnalysisResponse.parse(detail.analysis.visual)); });
router.get("/projects/:id/text-analysis", async (req, res): Promise<void> => { const p = GetProjectAnalysisParams.safeParse(req.params); if (!p.success) { res.status(400).json({ error: p.error.message }); return; } const detail = await getProject(p.data.id); if (!detail) { res.status(404).json({ error: "Project not found" }); return; } res.json(GetTextAnalysisResponse.parse(detail.analysis.text)); });
router.get("/projects/:id/geo-analysis", async (req, res): Promise<void> => { const p = GetProjectAnalysisParams.safeParse(req.params); if (!p.success) { res.status(400).json({ error: p.error.message }); return; } const detail = await getProject(p.data.id); if (!detail) { res.status(404).json({ error: "Project not found" }); return; } res.json(GetGeoAnalysisResponse.parse(detail.analysis.geo)); });
router.get("/projects/:id/temporal-analysis", async (req, res): Promise<void> => { const p = GetProjectAnalysisParams.safeParse(req.params); if (!p.success) { res.status(400).json({ error: p.error.message }); return; } const detail = await getProject(p.data.id); if (!detail) { res.status(404).json({ error: "Project not found" }); return; } res.json(GetTemporalAnalysisResponse.parse(detail.analysis.temporal)); });
router.get("/projects/:id/fusion-analysis", async (req, res): Promise<void> => { const p = GetProjectAnalysisParams.safeParse(req.params); if (!p.success) { res.status(400).json({ error: p.error.message }); return; } const detail = await getProject(p.data.id); if (!detail) { res.status(404).json({ error: "Project not found" }); return; } res.json(GetFusionAnalysisResponse.parse(detail.analysis.fusion)); });
router.get("/projects/:id/inconsistencies", async (req, res): Promise<void> => { const p = GetProjectAnalysisParams.safeParse(req.params); if (!p.success) { res.status(400).json({ error: p.error.message }); return; } const detail = await getProject(p.data.id); if (!detail) { res.status(404).json({ error: "Project not found" }); return; } res.json(GetInconsistenciesResponse.parse(detail.analysis.inconsistencies)); });
router.get("/projects/:id/risk", async (req, res): Promise<void> => { const p = GetProjectAnalysisParams.safeParse(req.params); if (!p.success) { res.status(400).json({ error: p.error.message }); return; } const detail = await getProject(p.data.id); if (!detail) { res.status(404).json({ error: "Project not found" }); return; } res.json(GetProjectRiskResponse.parse(detail.analysis.risk)); });

router.get("/projects/:id/investigation", async (req, res): Promise<void> => {
  const params = GetInvestigationParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const detail = await getProject(params.data.id);
  if (!detail) { res.status(404).json({ error: "Project not found" }); return; }
  res.json(GetInvestigationResponse.parse(detail.investigation));
});

router.post("/projects/:id/investigation", async (req, res): Promise<void> => {
  const params = UpdateInvestigationParams.safeParse(req.params);
  const body = UpdateInvestigationBody.safeParse(req.body);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  if (!body.success) { res.status(400).json({ error: body.error.message }); return; }
  if (!req.user) { res.status(401).json({ error: "Unauthorized" }); return; }
  const investigation = await updateInvestigationRecord(params.data.id, body.data.status, body.data.notes, body.data.decision, req.user);
  if (!investigation) { res.status(404).json({ error: "Project not found" }); return; }
  res.json(UpdateInvestigationResponse.parse(investigation));
});

// P0-N: the minimal authenticated write path for progress evidence — there
// was previously no legitimate way to create a worktruth_progress_records
// row at all (only the demo seed inserted them), so the temporal, cross-
// modal, fusion, and verification-priority engines could never see real
// progress data for a project created/imported through the normal API.
router.get("/projects/:id/progress", async (req, res): Promise<void> => {
  const params = ListProgressRecordsParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const [project] = await db.select({ id: projectsTable.id }).from(projectsTable).where(eq(projectsTable.id, params.data.id));
  if (!project) { res.status(404).json({ error: "Project not found" }); return; }
  const rows = await db.select().from(progressRecordsTable).where(eq(progressRecordsTable.projectId, params.data.id)).orderBy(progressRecordsTable.reportDate);
  res.json(ListProgressRecordsResponse.parse(rows.map((row) => ({ id: row.id, projectId: row.projectId, reportDate: row.reportDate, progressPercent: row.progressPercent, note: row.note, source: row.source, createdAt: row.createdAt.toISOString() }))));
});

router.post("/projects/:id/progress", async (req, res): Promise<void> => {
  const params = CreateProgressRecordParams.safeParse(req.params);
  const body = CreateProgressRecordBody.safeParse(req.body);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  if (!body.success) { res.status(400).json({ error: body.error.message }); return; }
  const [project] = await db.select({ id: projectsTable.id }).from(projectsTable).where(eq(projectsTable.id, params.data.id));
  if (!project) { res.status(404).json({ error: "Project not found" }); return; }
  const [created] = await db
    .insert(progressRecordsTable)
    .values({ projectId: params.data.id, reportDate: body.data.reportDate, progressPercent: body.data.progressPercent, note: body.data.note ?? "", source: "manual" })
    .returning();
  res.status(201).json(CreateProgressRecordResponse.parse({ id: created.id, projectId: created.projectId, reportDate: created.reportDate, progressPercent: created.progressPercent, note: created.note, source: created.source, createdAt: created.createdAt.toISOString() }));
});

router.post("/upload/projects", async (req, res): Promise<void> => {
  const parsed = UploadProjectsBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  await ensureSeeded();
  const [batch] = await db.insert(importBatchesTable).values({ sourceFilename: parsed.data.filename }).returning({ id: importBatchesTable.id });
  let imported = 0;
  const rowErrors: Array<{ row: number; errors: string[] }> = [];
  for (const [index, input] of parsed.data.records.entries()) {
    const sourceRow = parsed.data.rowNumbers?.[index] ?? index + 2;
    const validated = CreateProjectBody.safeParse(input);
    if (!validated.success) {
      rowErrors.push({
        row: sourceRow,
        errors: validated.error.issues.map((issue) => `${issue.path.join(".") || "record"}: ${issue.message}`),
      });
      continue;
    }
    const existing = await db.select({ id: projectsTable.id }).from(projectsTable).where(eq(projectsTable.id, validated.data.id));
    if (existing.length) {
      rowErrors.push({ row: sourceRow, errors: [`id: Project ID "${validated.data.id}" already exists`] });
      continue;
    }
    const validatedInput = validated.data;
    const row = {
      ...validatedInput,
      location: validatedInput.location ?? "Imported location",
      startDate: validatedInput.startDate ?? new Date().toISOString().slice(0, 10),
      expectedCompletion: validatedInput.expectedCompletion ?? new Date().toISOString().slice(0, 10),
      evidenceQuality: 0,
      priority: "MODERATE",
      primaryFlag: "Insufficient evidence",
      actualCompletion: null,
      contractor: "Imported record",
      source: "import" as const,
      importBatchId: batch.id,
    };
    await db.insert(projectsTable).values(row).onConflictDoNothing();
    const [saved] = await db.select().from(projectsTable).where(eq(projectsTable.id, row.id));
    if (saved) {
      // P0-N integration fix: previously the imported sanctionAmount/
      // expenditure scalars never reached worktruth_financial_records, so
      // financial-engine (and everything downstream of it) could never see
      // itemized ledger detail for an imported project. See
      // seedFinancialRecordsFromScalars's own doc comment for why the
      // dates are both set to the project's startDate.
      await seedFinancialRecordsFromScalars(saved, "import");
      const analysis = await buildAnalysis(saved);
      await db.insert(projectAnalysesTable).values({ projectId: saved.id, status: "Completed", payload: analysis }).onConflictDoNothing();
      await db.insert(analysisRunsTable).values({ projectId: saved.id, status: "Completed", payload: analysis, triggeredBy: `import:${batch.id}` });
      await db.insert(investigationsTable).values({ projectId: saved.id, status: "Pending Review", notes: "", decision: "" }).onConflictDoNothing();
      imported += 1;
    }
  }
  // Real acceptance rate — replaces a previous hardcoded 0.86 constant that
  // was applied whenever any row imported successfully, regardless of how
  // many rows in the same file actually failed validation.
  const totalRows = imported + rowErrors.length;
  const qualityScore = totalRows > 0 ? imported / totalRows : 0;
  await db
    .update(importBatchesTable)
    .set({ acceptedCount: imported, rejectedCount: rowErrors.length, qualityScore, rowErrors })
    .where(eq(importBatchesTable.id, batch.id));
  res.json(UploadProjectsResponse.parse({
    imported,
    rejected: rowErrors.length,
    missingFields: [],
    qualityScore,
    rowErrors,
  }));
});

router.get("/projects/:id/images", async (req, res): Promise<void> => {
  const params = ListProjectImagesParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const [project] = await db.select({ id: projectsTable.id }).from(projectsTable).where(eq(projectsTable.id, params.data.id));
  if (!project) { res.status(404).json({ error: "Project not found" }); return; }
  const rows = await db.select().from(evidenceImagesTable).where(eq(evidenceImagesTable.projectId, params.data.id)).orderBy(desc(evidenceImagesTable.uploadedAt));
  res.json(ListProjectImagesResponse.parse(rows.map(toEvidenceImage)));
});

router.post("/projects/:id/images", imageUpload.single("image"), async (req, res): Promise<void> => {
  const params = UploadProjectImageParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  if (!req.user) { res.status(401).json({ error: "Unauthorized" }); return; }
  const [project] = await db.select({ id: projectsTable.id }).from(projectsTable).where(eq(projectsTable.id, params.data.id));
  if (!project) { res.status(404).json({ error: "Project not found" }); return; }
  if (!req.file) {
    res.status(400).json({ error: "No image file was provided, or its type/size was rejected (jpeg/png/webp, up to 10MB)." });
    return;
  }

  const buffer = req.file.buffer;
  const metadata = await extractImageMetadata(buffer);
  if (metadata.width === null || metadata.height === null) {
    res.status(400).json({ error: "The uploaded file could not be decoded as a valid image." });
    return;
  }

  const sha256 = sha256Hex(buffer);
  const extension = MIME_EXTENSIONS[req.file.mimetype] ?? "bin";
  const storageKey = await evidenceStorage.save(params.data.id, buffer, extension);
  const rawLabel = req.body?.label;
  const label = typeof rawLabel === "string" && rawLabel.trim() ? rawLabel.trim() : null;

  const [saved] = await db
    .insert(evidenceImagesTable)
    .values({
      projectId: params.data.id,
      storageKey,
      originalFilename: req.file.originalname || null,
      mimeType: req.file.mimetype,
      fileSizeBytes: req.file.size,
      width: metadata.width,
      height: metadata.height,
      capturedAt: metadata.capturedAt,
      gpsLatitude: metadata.gpsLatitude,
      gpsLongitude: metadata.gpsLongitude,
      gpsAccuracyMeters: metadata.gpsAccuracyMeters,
      perceptualHash: metadata.perceptualHash,
      sha256,
      label,
      source: "officer_upload",
    })
    .returning();

  res.status(201).json(UploadProjectImageResponse.parse(toEvidenceImage(saved)));
});

router.get("/projects/:id/images/:imageId", async (req, res): Promise<void> => {
  const params = GetProjectImageParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const [row] = await db.select().from(evidenceImagesTable).where(and(eq(evidenceImagesTable.projectId, params.data.id), eq(evidenceImagesTable.id, params.data.imageId)));
  if (!row) { res.status(404).json({ error: "Image not found" }); return; }
  res.json(GetProjectImageResponse.parse(toEvidenceImage(row)));
});

router.delete("/projects/:id/images/:imageId", async (req, res): Promise<void> => {
  const params = DeleteProjectImageParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const [row] = await db.select().from(evidenceImagesTable).where(and(eq(evidenceImagesTable.projectId, params.data.id), eq(evidenceImagesTable.id, params.data.imageId)));
  if (!row) { res.status(404).json({ error: "Image not found" }); return; }
  await db.delete(evidenceImagesTable).where(eq(evidenceImagesTable.id, row.id));
  await evidenceStorage.delete(row.storageKey);
  res.status(204).end();
});

router.get("/projects/:id/images/:imageId/file", async (req, res): Promise<void> => {
  const params = GetProjectImageFileParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const [row] = await db.select().from(evidenceImagesTable).where(and(eq(evidenceImagesTable.projectId, params.data.id), eq(evidenceImagesTable.id, params.data.imageId)));
  if (!row) { res.status(404).json({ error: "Image not found" }); return; }
  try {
    const buffer = await evidenceStorage.read(row.storageKey);
    res.setHeader("Content-Type", row.mimeType ?? "application/octet-stream");
    res.setHeader("Cache-Control", "private, max-age=86400");
    res.send(buffer);
  } catch {
    // Render's Free-tier filesystem is ephemeral — a seed_demo image's file
    // under EVIDENCE_UPLOAD_DIR can be lost across a deploy/restart even
    // though its DB row (GPS, capture date, hash, label) survives in
    // Postgres. That file is a deterministic synthetic image with no
    // project-specific pixel data (see buildSeedEvidenceImageBuffer's doc
    // comment), so regenerating it here reproduces the exact same bytes
    // already hashed into this row's sha256/perceptualHash at seed time —
    // not a different or fabricated image. Never applies to a real officer
    // upload (source is "officer_upload" there): a genuinely lost real
    // upload still 404s, exactly as before.
    if (row.source === "seed_demo") {
      const buffer = await buildSeedEvidenceImageBuffer();
      res.setHeader("Content-Type", row.mimeType ?? "image/png");
      res.setHeader("Cache-Control", "private, max-age=86400");
      res.send(buffer);
      return;
    }
    res.status(404).json({ error: "Stored file not found" });
  }
});

export default router;