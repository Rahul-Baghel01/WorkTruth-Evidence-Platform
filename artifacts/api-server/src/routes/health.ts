import { Router, type IRouter } from "express";
import { pool } from "@workspace/db";
import { HealthCheckResponse } from "@workspace/api-zod";
import { logger } from "../lib/logger";

const router: IRouter = Router();

// A readiness check, not just a liveness check (P0-N) — confirms the API
// process can actually reach PostgreSQL right now, via a trivial query, not
// merely that the HTTP server is accepting connections. This never fails
// because of an optional external AI provider: WorkTruth's analysis
// pipeline has none today (see .env.example), so there is nothing else to
// check here.
router.get("/healthz", async (_req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json(HealthCheckResponse.parse({ status: "ok", database: "ok" }));
  } catch (err) {
    logger.error({ err }, "Health check: database unreachable");
    res.status(503).json(HealthCheckResponse.parse({ status: "degraded", database: "unavailable" }));
  }
});

export default router;
