import app from "./app";
import { logger } from "./lib/logger";

const DEFAULT_PORT = 5000;
const rawPort = process.env["PORT"];
// PORT is injected by the hosting platform in production (Render sets it);
// 5000 is only the local fallback.
const port = rawPort ? Number(rawPort) : DEFAULT_PORT;

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

// Bind all interfaces — required by Render (and most container hosts), which
// route external traffic to 0.0.0.0:$PORT. Overridable via HOST for the rare
// case that a local setup wants loopback only.
const host = process.env.HOST || "0.0.0.0";

if (!process.env.SEED_OFFICER_EMAIL || !process.env.SEED_OFFICER_PASSWORD) {
  logger.warn(
    "SEED_OFFICER_EMAIL/SEED_OFFICER_PASSWORD are not set — no officer account will be available to log in with. Set them in the environment (locally: copy .env.example to .env).",
  );
}

if (process.env.NODE_ENV === "production" && !process.env.EVIDENCE_UPLOAD_DIR) {
  logger.warn(
    "EVIDENCE_UPLOAD_DIR is not set in production — uploaded evidence will be written to an ephemeral path under the app directory and lost on redeploy/restart. Point it at a persistent volume (e.g. /var/data/uploads).",
  );
}

app.listen(port, host, () => {
  logger.info({ port, host }, "Server listening");
});
