import { Router, type IRouter, type Request, type Response } from "express";
import { eq } from "drizzle-orm";
import { db } from "@workspace/db";
import { projectsTable, projectAnalysesTable, investigationsTable } from "@workspace/db";
import {
  AnalyzeProjectParams,
  AnalyzeProjectResponse,
  CreateProjectBody,
  CreateProjectResponse,
  GetDashboardActivityResponse,
  GetDashboardStatsResponse,
  GetFinancialAnalysisResponse,
  GetGeoAnalysisResponse,
  GetInvestigationParams,
  GetInvestigationResponse,
  GetProjectAnalysisParams,
  GetProjectAnalysisResponse,
  GetProjectParams,
  GetProjectResponse,
  GetProjectRiskResponse,
  GetTemporalAnalysisResponse,
  GetTextAnalysisResponse,
  GetVisualAnalysisResponse,
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
  UploadProjectsBody,
  UploadProjectsResponse,
} from "@workspace/api-zod";
import {
  buildAnalysis,
  ensureSeeded,
  getProject,
  listProjectRows,
  toProject,
  updateInvestigationRecord,
} from "../lib/worktruth";

const router: IRouter = Router();

router.post("/auth/login", (req, res): void => {
  const parsed = LoginBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  if (parsed.data.email !== "officer@worktruth.gov.in" || parsed.data.password !== "worktruth123") {
    res.status(401).json({ error: "Invalid demo credentials" });
    return;
  }
  res.json(LoginResponse.parse({
    token: "demo-officer-session",
    user: { name: "Aarav Mehta", email: parsed.data.email, role: "District Monitoring Officer" },
  }));
});

router.get("/dashboard/stats", async (_req, res): Promise<void> => {
  const rows = await listProjectRows();
  const projects = rows.map(toProject);
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
    anomalySignals: signalLabels.map((label) => ({ label, value: projects.filter((project) => project.primaryFlag.toLowerCase().includes(label.toLowerCase().slice(0, 5))).length + (label === "Financial" ? 4 : 0) })),
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

router.get("/dashboard/activity", async (_req, res): Promise<void> => {
  const activity = [
    { id: "act-1", type: "critical", title: "High verification priority", detail: "P-1089 has a combined financial, visual, GPS, and temporal signal.", time: "12 min ago", projectId: "P-1089" },
    { id: "act-2", type: "geo", title: "GPS mismatch detected", detail: "P-4150 photograph metadata is 2.1 km from the declared worksite.", time: "38 min ago", projectId: "P-4150" },
    { id: "act-3", type: "text", title: "Description overlap identified", detail: "P-3022 may overlap with another community-centre record.", time: "1 hr ago", projectId: "P-3022" },
    { id: "act-4", type: "evidence", title: "Evidence batch refreshed", detail: "14 new project photographs were indexed for comparison.", time: "Yesterday", projectId: null },
  ];
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
  if (query.priority) rows = rows.filter((row) => row.priority === query.priority);
  if (query.district) rows = rows.filter((row) => row.district === query.district);
  if (query.category) rows = rows.filter((row) => row.category === query.category);
  if (query.sort === "evidence") rows.sort((a, b) => a.evidenceQuality - b.evidenceQuality);
  if (query.sort === "financial") rows.sort((a, b) => b.expenditure / b.sanctionAmount - a.expenditure / a.sanctionAmount);
  if (query.sort === "visual") rows.sort((a, b) => (b.priority === "HIGH" ? 1 : 0) - (a.priority === "HIGH" ? 1 : 0));
  const page = query.page ?? 1;
  const pageSize = query.pageSize ?? 20;
  const all = rows.map(toProject);
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
  await db.insert(projectAnalysesTable).values({ projectId: row.id, status: "Queued", payload: buildAnalysis(row as never) });
  await db.insert(investigationsTable).values({ projectId: row.id, status: "Pending Review", notes: "", decision: "" });
  res.status(201).json(CreateProjectResponse.parse(toProject(row as never)));
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
  res.json(GetProjectResponse.parse({ ...toProject(detail.project), description: detail.project.description, contractor: detail.project.contractor, analysis: detail.analysis, investigation: detail.investigation }));
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
  res.json(UpdateProjectResponse.parse(toProject(detail.project)));
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
  const analysis = buildAnalysis(detail.project);
  await db.update(projectAnalysesTable).set({ status: "Completed", payload: analysis, updatedAt: new Date() }).where(eq(projectAnalysesTable.projectId, params.data.id));
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
  const investigation = await updateInvestigationRecord(params.data.id, body.data.status, body.data.notes, body.data.decision);
  if (!investigation) { res.status(404).json({ error: "Project not found" }); return; }
  res.json(UpdateInvestigationResponse.parse(investigation));
});

router.post("/upload/projects", async (req, res): Promise<void> => {
  const parsed = UploadProjectsBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  await ensureSeeded();
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
    };
    await db.insert(projectsTable).values(row).onConflictDoNothing();
    const [saved] = await db.select().from(projectsTable).where(eq(projectsTable.id, row.id));
    if (saved) {
      await db.insert(projectAnalysesTable).values({ projectId: saved.id, status: "Completed", payload: buildAnalysis(saved) }).onConflictDoNothing();
      await db.insert(investigationsTable).values({ projectId: saved.id, status: "Pending Review", notes: "", decision: "" }).onConflictDoNothing();
      imported += 1;
    }
  }
  res.json(UploadProjectsResponse.parse({
    imported,
    rejected: rowErrors.length,
    missingFields: [],
    qualityScore: imported ? 0.86 : 0,
    rowErrors,
  }));
});

export default router;