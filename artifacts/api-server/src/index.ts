import app from "./app";
import { logger } from "./lib/logger";

const DEFAULT_PORT = 5000;
const rawPort = process.env["PORT"];
// PORT is optional for the standalone local server; 5000 is the fallback.
const port = rawPort ? Number(rawPort) : DEFAULT_PORT;

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

// Bind all interfaces by default; HOST can restrict a local setup to loopback.
const host = process.env.HOST || "0.0.0.0";

if (!process.env.SEED_OFFICER_EMAIL || !process.env.SEED_OFFICER_PASSWORD) {
  logger.warn(
    "SEED_OFFICER_EMAIL/SEED_OFFICER_PASSWORD are not set — no officer account will be available to log in with. Set them in the environment (locally: copy .env.example to .env).",
  );
}

app.listen(port, host, () => {
  logger.info({ port, host }, "Server listening");
});
