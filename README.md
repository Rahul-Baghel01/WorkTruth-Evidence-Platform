# WorkTruth

An evidence-verification and verification-prioritization platform for MPLADS project monitoring — it cross-checks financial, visual, geospatial, text, and temporal signals for a project and surfaces a Verification Priority (LOW/MODERATE/HIGH/CRITICAL) for a human officer to review. It does not claim to prove fraud.

## WorkTruth Local Setup

WorkTruth runs entirely on your own machine — a React/Vite frontend, an
Express API server, and PostgreSQL. There is no Replit dependency anywhere
in this repository, and no external AI API is required (see "Optional
external APIs" below).

### Requirements

- Node.js 22+ and [pnpm](https://pnpm.io)
- [Docker Desktop](https://www.docker.com/products/docker-desktop/) (for local PostgreSQL) — or any PostgreSQL 16 instance you already run yourself

### 1. Clone

```
git clone <this repository>
cd WorkTruth-Evidence-Platform
```

### 2. Install

```
pnpm install
```

### 3. Configure environment

```
cp .env.example .env
```

On Windows without a Unix-like shell, copy the file manually in File
Explorer (or `Copy-Item .env.example .env` in PowerShell) and rename it to
`.env`. The defaults in `.env.example` already match the Docker Compose
setup below — nothing else needs editing to get started, except
`SEED_OFFICER_*` (see "Login" below).

### 4. Start PostgreSQL

```
docker compose up -d --wait
```

This starts a local-development-only PostgreSQL 16 container (db/user
`worktruth`, see `docker-compose.yml`) with a persistent volume, and waits
for its healthcheck before returning. `pnpm db:up` is a shorthand for the
same command. Already running your own PostgreSQL 16+ instance instead? Skip
this step and point `DATABASE_URL` in `.env` at it.

### 5. Apply schema

```
pnpm db:push
```

Pushes the complete Drizzle schema (every table from every phase) directly
to the database — there are no separate migration files to run.

### 6. Seed development data

```
pnpm db:seed
```

Creates the one development officer account (from `SEED_OFFICER_*` in
`.env`) and, if the projects table is empty, a set of clearly-marked
synthetic demo projects with real financial/progress/image evidence — see
"Seed data" below. This step is idempotent and also runs automatically the
first time any API request needs it, so running `pnpm dev` without it first
still works; running it explicitly just makes the setup step visible.

Steps 5 and 6 together are also available as `pnpm db:setup`.

### 7. Start application

```
pnpm dev
```

Runs the frontend and API server together.

### URLs

- Frontend: http://localhost:5173
- API: http://localhost:5000
- Health: http://localhost:5000/api/healthz (also verifies the database connection)

### Other commands

- `pnpm dev:frontend` / `pnpm dev:api` — run just one side
- `pnpm db:down` — stop PostgreSQL (keeps its data)
- `pnpm db:reset` — wipe the database volume entirely and rebuild it from scratch (schema + seed)
- `pnpm run typecheck` / `pnpm run build` / `pnpm run test` — see below
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec (never hand-edit the generated files)

There is deliberately no single `pnpm setup` command: `setup` is a reserved
pnpm CLI subcommand (`pnpm setup` configures pnpm's own global bin path), so
a same-named package.json script would silently never run. `pnpm db:up &&
pnpm db:setup && pnpm dev` is the equivalent one-time flow.

### Login

There is no built-in account. `pnpm db:seed` (or the first API request)
creates exactly one development officer account, from three environment
variables you set yourself in `.env`:

```
SEED_OFFICER_EMAIL=you@example.com
SEED_OFFICER_NAME=Your Name
SEED_OFFICER_PASSWORD=pick-your-own-password
```

Log in at http://localhost:5173 with whatever you set. If these three
variables are unset, no account exists and the API server logs a warning on
startup. Sessions are opaque, random, database-backed tokens (see
`artifacts/api-server/src/lib/auth.ts`) — there is no `SESSION_SECRET` to
configure; none of the login/session code reads one.

### Evidence storage

Uploaded evidence images are stored on the local filesystem, under
`EVIDENCE_UPLOAD_DIR` (optional — defaults to `./uploads` relative to where
the API server process runs, i.e. `artifacts/api-server/uploads`). This
directory is gitignored. The storage layer validates file type and size and
rejects any path that would escape the upload directory — see
`artifacts/api-server/src/lib/storage.ts`.

### Seed data

The demo projects created by `pnpm db:seed` are clearly marked
(`source: "seed_demo"` on the project row) and are not, and do not claim to
be, real government data. Each seed project's financial, progress, and
image evidence is real row data — the five analysis engines (financial,
geospatial, temporal, text, visual) and everything downstream of them
(fusion, cross-modal inconsistencies, verification priority) always compute
their result from that data; nothing about a seed project's analysis is
itself hardcoded.

### Optional external APIs

The core WorkTruth analysis pipeline currently runs without an external AI
API. See `.env.example` for details — there is nothing to configure here
today.

### Production note

`docker-compose.yml`'s PostgreSQL credentials are local-development defaults
only — never reuse them for a real deployment. In any environment where the
frontend and API are served from different origins, set `CORS_ORIGIN` (see
`.env.example`) instead of leaving CORS wildcard-permissive.

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

_Populate as you build — short repo map plus pointers to the source-of-truth file for DB schema, API contracts, theme files, etc._

## Architecture decisions

_Populate as you build — non-obvious choices a reader couldn't infer from the code (3-5 bullets)._

## Product

_Describe the high-level user-facing capabilities of this app once they exist._

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

- The frontend and API server use different port env vars on purpose (`WEB_PORT` vs `PORT`) so `pnpm run dev` can run both under one parent shell without a collision.
- In dev, the frontend's Vite server proxies `/api/*` to the API server (see `server.proxy` in `artifacts/worktruth/vite.config.ts`) — the app always calls relative `/api/...` paths, never an absolute API URL.
- `artifacts/mockup-sandbox` is a standalone design prototype with its own dependencies. It is not imported by, and does not affect, `worktruth` or `api-server`.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
