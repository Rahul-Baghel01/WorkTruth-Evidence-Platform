import { defineConfig } from "drizzle-kit";

// drizzle-kit's own config loader does not populate import.meta.dirname (nor
// __dirname, since this file is ESM), so paths here are relative to the CWD
// pnpm sets when it runs this package's scripts — i.e. lib/db.
try {
  process.loadEnvFile("../../.env");
} catch {
  // No root .env file — fall back to whatever is already in the environment.
}

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL is required. Copy .env.example to .env and set it, or export it in your shell.",
  );
}

export default defineConfig({
  schema: "./src/schema/index.ts",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL,
  },
});
