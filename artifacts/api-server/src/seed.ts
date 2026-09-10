// Explicit, standalone seed entry point — `pnpm db:seed`. Runs the exact
// same idempotent seeding logic (`ensureSeeded`) that already runs lazily on
// the first API request; this just lets a developer run it deliberately,
// before starting the server, as part of the documented setup flow
// (docker compose up -d --wait -> pnpm db:push -> pnpm db:seed -> pnpm dev).
// No parallel seeding logic — reuses worktruth.ts's real implementation.
import { ensureSeeded } from "./lib/worktruth";
import { logger } from "./lib/logger";

ensureSeeded()
  .then(() => {
    logger.info("Database seed complete.");
    process.exit(0);
  })
  .catch((err) => {
    logger.error({ err }, "Database seed failed.");
    process.exit(1);
  });
