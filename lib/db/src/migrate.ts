// Idempotent schema bootstrap for a Postgres database that already has the
// generated SQL migrations under ./drizzle (see `generate` in package.json)
// but does not yet have the WorkTruth tables. Used locally and for the Neon
// bootstrap step (`pnpm db:migrate` — see VERCEL_DEPLOYMENT.md).
//
// -----------------------------------------------------------------------
// Why this is a hand-rolled `pg` script rather than drizzle-kit or
// drizzle-orm's own migrator
// -----------------------------------------------------------------------
// drizzle-kit's CLI (`push`/`check`/`migrate`) introspects the live
// database's catalogs before doing anything, and that introspection was
// observed to hang/error against this project's target database — see the
// git history of this file for that investigation. That ruled out the CLI
// entirely.
//
// The first version of this script used drizzle-orm's OWN programmatic
// migrator (`drizzle-orm/node-postgres/migrator`) instead, which avoids the
// CLI's introspection — but it creates a separate "drizzle" schema for its
// tracking table. This script tracks migrations inside the existing public
// schema, so the database role needs no separate schema-creation privilege.
//
// So this script never creates a schema. It:
//   1. Reads the migration journal + SQL files from ./drizzle directly
//      (the exact bytes `drizzle-kit generate` produced — nothing here is
//      hand-recreated or re-derived from the schema source) and splits each
//      file on drizzle-kit's own "--> statement-breakpoint" markers, the
//      same convention drizzle-orm's own file reader uses.
//   2. CREATE TABLE IF NOT EXISTS "public"."__worktruth_migrations" — a
//      tracking table in the schema that already exists and that this role
//      can already write to (it's the same schema every application table
//      lives in).
//   3. Applies only migration files not yet recorded there, each file's
//      statements (already in the CREATE TABLE -> ADD CONSTRAINT (FK) ->
//      CREATE INDEX order drizzle-kit generated them in) plus its tracking
//      row insert wrapped in ONE transaction, rolled back whole on any
//      error.
// A second run finds every migration already recorded and applies nothing
// — safe to run again, and never touches existing data.
//
// DATABASE_URL is read from the environment exactly like index.ts and
// drizzle.config.ts — never hardcoded, never logged. No other secret is
// read, logged, or included in any error message here (pg driver errors
// from this codepath carry only a message/code, e.g. "relation already
// exists" — never the connection string).
//
// -----------------------------------------------------------------------
// TLS
// -----------------------------------------------------------------------
// Remote connections request TLS with normal certificate verification.
// Local Docker PostgreSQL uses plaintext on loopback. DATABASE_SSL can
// override host detection when a private database uses a different topology.
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL is required. Copy .env.example to .env and set it, or export it in your shell.",
  );
}

// Resolve relative to this file (not process.cwd()) so this works the same
// way regardless of the directory it's invoked from.
const migrationsFolder = fileURLToPath(new URL("../drizzle", import.meta.url));

// DATABASE_SSL explicitly forces the decision ("require" | "disable") when
// set — for any target where host-based detection below would guess wrong.
// Left unset (the normal case), the target is detected by host: the only
// non-TLS Postgres this project talks to is the local docker-compose
// instance, always reached at localhost. Never logs `connectionString`.
function resolveSsl(connectionString: string): boolean {
  const override = process.env.DATABASE_SSL?.trim().toLowerCase();
  if (override === "disable" || override === "false") return false;
  if (override === "require" || override === "true") return true;

  let host: string;
  try {
    host = new URL(connectionString).hostname;
  } catch {
    // Not parseable as a URL (e.g. a bare host:port/db form with no
    // scheme) — fail safe toward encryption rather than silently
    // connecting in plaintext to an unrecognized target.
    return true;
  }
  // WHATWG URL keeps the brackets on a bracketed IPv6 host ("[::1]"), so
  // check both forms.
  const isLocal = host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]";
  return !isLocal;
}

// Lives in "public" (see header comment) — leading double underscore keeps
// it visually distinct from every real `worktruth_*` application table.
const MIGRATIONS_TABLE = "__worktruth_migrations";
const STATEMENT_BREAKPOINT = "--> statement-breakpoint";

type JournalEntry = { tag: string; when: number };
type Migration = { tag: string; hash: string; statements: string[] };

function loadMigrations(): Migration[] {
  const journalPath = path.join(migrationsFolder, "meta", "_journal.json");
  if (!existsSync(journalPath)) {
    throw new Error(
      `No migrations found at ${journalPath}. Run "pnpm --filter @workspace/db run generate" first and commit the result.`,
    );
  }
  const journal: { entries: JournalEntry[] } = JSON.parse(readFileSync(journalPath, "utf8"));
  return journal.entries
    .slice()
    .sort((a, b) => a.when - b.when)
    .map(({ tag }) => {
      const sqlPath = path.join(migrationsFolder, `${tag}.sql`);
      const raw = readFileSync(sqlPath, "utf8");
      const statements = raw
        .split(STATEMENT_BREAKPOINT)
        .map((statement) => statement.trim())
        .filter(Boolean);
      return { tag, hash: createHash("sha256").update(raw).digest("hex"), statements };
    });
}

async function main() {
  const connectionString = process.env.DATABASE_URL!;
  const pool = new Pool({ connectionString, ssl: resolveSsl(connectionString) });
  const client = await pool.connect();
  try {
    await client.query(
      `CREATE TABLE IF NOT EXISTS "public"."${MIGRATIONS_TABLE}" (
        id SERIAL PRIMARY KEY,
        tag text NOT NULL UNIQUE,
        hash text NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT now()
      )`,
    );

    const migrations = loadMigrations();
    const { rows: appliedRows } = await client.query<{ tag: string }>(
      `SELECT tag FROM "public"."${MIGRATIONS_TABLE}"`,
    );
    const applied = new Set(appliedRows.map((row) => row.tag));

    let appliedCount = 0;
    for (const migration of migrations) {
      if (applied.has(migration.tag)) {
        console.log(`  - ${migration.tag}: already applied, skipping`);
        continue;
      }
      console.log(`  - ${migration.tag}: applying ${migration.statements.length} statement(s)...`);
      try {
        await client.query("BEGIN");
        for (const statement of migration.statements) {
          await client.query(statement);
        }
        await client.query(
          `INSERT INTO "public"."${MIGRATIONS_TABLE}" (tag, hash) VALUES ($1, $2)`,
          [migration.tag, migration.hash],
        );
        await client.query("COMMIT");
        appliedCount += 1;
      } catch (err) {
        await client.query("ROLLBACK");
        throw new Error(
          `Migration "${migration.tag}" failed and was rolled back — no partial changes were kept: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }

    console.log(
      appliedCount > 0
        ? `Done. Applied ${appliedCount} migration(s).`
        : "Done. Nothing to apply — schema is already up to date.",
    );
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error("Migration failed:", err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
