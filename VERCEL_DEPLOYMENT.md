# Deploy WorkTruth on Vercel and Neon

## Architecture

```text
GitHub main → Vercel project
                 ├── React/Vite static frontend
                 └── /api/* → api/index.mjs → Express app
                                                └── Neon PostgreSQL
```

`vercel.json` builds the API bundle and frontend, packages `artifacts/api-server/dist/app.mjs` with the function, rewrites `/api/*` to that function, and sends other application routes to the SPA. The browser uses relative `/api/*` calls. The local entry point, `artifacts/api-server/src/index.ts`, starts a normal Express listener; the Vercel entry point exports the same app without listening. Sessions use a first-party `HttpOnly; Secure; SameSite=Lax` cookie in production.

## Prerequisites

- GitHub access to this repository and a Vercel account connected to it.
- A Neon PostgreSQL database. Use its pooled connection string for the deployed API and its direct connection string for migrations and one-time seeding.
- Node.js 22.9 or newer and pnpm 10.4.1 for local commands.

## Database setup

Apply committed SQL migrations from a trusted local machine before deploying the app. `db:migrate` records applied files in `public.__worktruth_migrations` and can be rerun. Use a direct Neon connection with TLS and keep its credentials out of Git and terminal logs.

```powershell
$env:DATABASE_URL = '<direct Neon connection string>'
pnpm install --frozen-lockfile
pnpm db:migrate
```

To populate a **dedicated demo database** with 23 synthetic projects and an officer account, set `SEED_DEMO_DATA=true`, `SEED_OFFICER_EMAIL`, and a strong `SEED_OFFICER_PASSWORD` only in the command environment, then run `pnpm db:seed`. The seed does not overwrite an existing nonempty project register. Run `pnpm db:reanalyze` after changing evidence that should affect saved analyses. Keep the direct URL and officer credentials private.

`SEED_DEMO_DATA` defaults to false when `NODE_ENV=production`; the production function should never race to seed a fresh database. The one-time seed can create the guest account and, when configured, an admin account. Seeded project and image provenance is marked as demo data.

## Vercel project

Import the GitHub repository with the **repository root** as the Vercel root directory. The checked-in `vercel.json` supplies:

| Setting | Value |
|---|---|
| Install | `pnpm install --frozen-lockfile --prod=false` |
| Build | `pnpm run build:api && pnpm run build:frontend` |
| Output | `artifacts/worktruth/dist/public` |
| API function | `api/index.mjs`, with `artifacts/api-server/dist/**` included |

Set these Vercel environment variables for the deployed API:

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Neon pooled PostgreSQL connection string with TLS |
| `NODE_ENV` | `production`, for secure session cookies and production defaults |
| `SEED_OFFICER_EMAIL` / `SEED_OFFICER_PASSWORD` | Provision or rotate the demo officer account when desired |
| `SEED_OFFICER_NAME` | Optional display name |
| `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` | Optional initial admin account |
| `GUEST_DEMO_ENABLED` | Optional; defaults to enabled. Set `false` to disable guest access |

Do not set `SEED_DEMO_DATA=true` in Vercel. Seed intentionally, once, from a trusted machine. The frontend requires no external API origin variable; its API calls stay on the deployment's own origin. No separate cross-origin cookie or CORS configuration is needed.

Deploy from `main` after migrations and seeding. Confirm `/api/healthz` responds, then check guest login, dashboard, P-1089, and the officer workflow in the deployed app. The Vercel build does not migrate or seed the database.

## Filesystem behavior

The two P-1089 demo photographs are committed under `artifacts/worktruth/public/evidence/`. Their bytes are used for the seeded hashes and are served as static frontend assets. They survive function recycling.

Officer image uploads are written to the function instance's temporary directory. Their database rows persist, but the file bytes can disappear when that instance is replaced. A missing real upload returns 404; the app does not claim durable upload storage. Local development writes uploads under `artifacts/api-server/uploads/`. Production object storage is future work. Vercel's request size limit may reject a photo even though the Express upload limit is 10 MB.

## Local development and checks

Copy `.env.example` to `.env`, set local values, and keep `.env` untracked. Start the local PostgreSQL container, apply migrations or the local schema, seed the demo, then start both development servers:

```powershell
pnpm install
pnpm db:up
pnpm db:migrate
pnpm db:seed
pnpm dev
```

The Vite dev server proxies `/api/*` to the local Express server. Verify changes with `pnpm typecheck`, `pnpm test`, `pnpm build:api`, `pnpm build:frontend`, and `pnpm build`.

## Deployment limits

The analysis thresholds and fusion weights are documented heuristics, not calibrated fraud probabilities. The bundled portfolio is synthetic. New evidence requires a deliberate reanalysis. Uploaded image bytes are temporary on Vercel. The map is schematic. Officers make all verification decisions.
