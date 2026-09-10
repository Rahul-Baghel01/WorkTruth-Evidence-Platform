// Maintenance entry point — `pnpm db:reanalyze`. Recomputes and re-persists
// every project's analysis payload with the current engine + data-contract
// code, exactly as clicking "Re-run analysis" on each project would. Use it
// after an evidence-engine or AnalysisBundle-contract change so already-
// stored payloads stop lagging the code. It is NOT a database reset: no
// project, evidence, financial, progress or investigation record is touched,
// and analysis_runs keeps its full append-only history (a row per run here,
// triggeredBy "reanalyze_script").
import { eq } from "drizzle-orm";
import { db, analysisRunsTable, projectAnalysesTable, projectsTable } from "@workspace/db";
import { buildAnalysis } from "./lib/worktruth";
import { logger } from "./lib/logger";

async function reanalyzeAll() {
  const projects = await db.select().from(projectsTable);
  let updated = 0;
  for (const project of projects) {
    const payload = await buildAnalysis(project);
    await db
      .update(projectAnalysesTable)
      .set({ status: "Completed", payload, updatedAt: new Date() })
      .where(eq(projectAnalysesTable.projectId, project.id));
    await db.insert(analysisRunsTable).values({ projectId: project.id, status: "Completed", payload, triggeredBy: "reanalyze_script" });
    updated += 1;
  }
  return { total: projects.length, updated };
}

reanalyzeAll()
  .then(({ total, updated }) => {
    logger.info({ total, updated }, "Reanalyze complete.");
    process.exit(0);
  })
  .catch((err) => {
    logger.error({ err }, "Reanalyze failed.");
    process.exit(1);
  });
