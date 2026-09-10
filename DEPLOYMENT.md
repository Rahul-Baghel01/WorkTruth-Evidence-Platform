# Deploying WorkTruth to Render

WorkTruth deploys as **four** Render resources:

| Resource | Render type | Serves |
|---|---|---|
| `worktruth-web` | Static Site | the built frontend (`artifacts/worktruth`) |
| `worktruth-api` | Web Service (Node) | the Express API (`artifacts/api-server`) |
| `worktruth-db` | PostgreSQL | the Drizzle-managed database |
| `worktruth-evidence` | Persistent Disk (attached to `worktruth-api`) | uploaded evidence files |

The frontend and API are served from **different origins**, so the API uses
`CORS_ORIGIN` + a `SameSite=None; Secure` session cookie, and the frontend
sends credentialed requests to `VITE_API_BASE_URL`. Locally nothing changes:
the Vite dev proxy keeps `/api` same‑origin and the cookie stays `SameSite=Lax`.

A `render.yaml` Blueprint at the repo root wires most of this up; the
step‑by‑step below is the equivalent via the dashboard. Either way, three
values can only be filled in once the other resources exist
(`VITE_API_BASE_URL`, `CORS_ORIGIN`) or are secrets (`SEED_OFFICER_*`).

Repo prerequisites (already committed): `.node-version` = `22`,
`"packageManager": "pnpm@10.4.1"` and `"engines": { "node": ">=22.9.0" }` in
the root `package.json`, and `pnpm-lock.yaml`.

---

## 1. PostgreSQL — `worktruth-db`

1. **New → PostgreSQL.** Name `worktruth-db`, database name `worktruth`, user
   `worktruth`. Pick a region and reuse it for the API service.
2. Free Postgres is **deleted after 30 days** — use a paid plan for anything
   real.
3. After it provisions, copy the **Internal Database URL** — that is
   `DATABASE_URL` for the API service (internal = same‑region, no egress).

### Initialise the schema (once, against the empty database)

The app never migrates automatically. From your machine, with the database's
**External** URL:

```bash
DATABASE_URL="postgresql://worktruth:...@...render.com/worktruth" pnpm db:push
```

`pnpm db:push` (drizzle-kit push) creates every table from
`lib/db/src/schema/index.ts`. Against a brand‑new empty database it runs
non‑interactively. Re‑run it after any future schema change.

> No demo data is inserted. `NODE_ENV=production` on the API stops the
> 20‑project demo dataset from ever being auto‑seeded (see §5).

---

## 2. API — `worktruth-api` (Web Service)

**New → Web Service**, connect this repo.

| Setting | Value |
|---|---|
| Root Directory | `.` (repo root — it is a pnpm workspace) |
| Runtime | Node |
| Build Command | `pnpm install --frozen-lockfile && pnpm run build:api` |
| Start Command | `pnpm run start:api` |
| Health Check Path | `/api/healthz` |

`build:api` runs esbuild (`artifacts/api-server/build.mjs`) → a bundled
`artifacts/api-server/dist/index.mjs`. `start:api` runs
`node --env-file-if-exists=../../.env dist/index.mjs`; there is no `.env` on
Render so it reads the dashboard environment. The server binds `0.0.0.0:$PORT`
(Render injects `PORT`; `5000` is only the local fallback).

`/api/healthz` returns `200 {"status":"ok","database":"ok"}` only when the API
can reach Postgres, so Render will not route traffic to a broken deploy.

### Persistent disk (evidence storage)

Add a disk to this service **before the first deploy**:

| Setting | Value |
|---|---|
| Name | `worktruth-evidence` |
| Mount Path | `/var/data` |
| Size | 1 GB (grow later) |

Then set `EVIDENCE_UPLOAD_DIR=/var/data/uploads` (below). The directory is
created on first upload. The existing path‑traversal / extension checks in
`artifacts/api-server/src/lib/storage.ts` are unchanged — uploads are still
confined to that root. Without the disk, uploads land on the container's
ephemeral filesystem and vanish on every deploy/restart (the API logs a
warning at startup if `EVIDENCE_UPLOAD_DIR` is unset in production).

> A single persistent disk means this API service **cannot** be scaled beyond
> one instance. That is fine for now; moving to object storage (S3‑compatible)
> is the path to horizontal scaling and is deliberately out of scope here.

### API environment variables

| Key | Value | Notes |
|---|---|---|
| `NODE_ENV` | `production` | Secure cookie; disables demo‑data auto‑seed |
| `DATABASE_URL` | *Internal Database URL of `worktruth-db`* | |
| `EVIDENCE_UPLOAD_DIR` | `/var/data/uploads` | must be under the disk mount |
| `CORS_ORIGIN` | `https://worktruth-web.onrender.com` | the **frontend** origin, exact, no trailing slash; fill in after §3. Comma‑separate for multiple (custom domain + onrender URL) |
| `SEED_OFFICER_EMAIL` | *your officer login email* | secret |
| `SEED_OFFICER_PASSWORD` | *a strong password* | secret — never commit |
| `SEED_OFFICER_NAME` | `Duty Officer` | optional |
| `PORT` | *(leave unset)* | Render injects it |

Do **not** set `SEED_DEMO_DATA` unless you actually want the 20 demo projects
in this database (then set it to `true`).

The officer account is created (or its password rotated to match) on the first
API request after these are set — no seed command required in production.

---

## 3. Frontend — `worktruth-web` (Static Site)

**New → Static Site**, same repo.

| Setting | Value |
|---|---|
| Root Directory | `.` |
| Build Command | `pnpm install --frozen-lockfile && pnpm run build:frontend` |
| Publish Directory | `artifacts/worktruth/dist/public` |

**Redirect/Rewrite rule** (Settings → Redirects/Rewrites), required for
client‑side routing:

| Source | Destination | Action |
|---|---|---|
| `/*` | `/index.html` | Rewrite |

### Frontend environment variables

| Key | Value | Notes |
|---|---|---|
| `VITE_API_BASE_URL` | `https://worktruth-api.onrender.com` | the **API** origin, exact, no trailing slash. Build‑time only — inlined into the JS bundle |

`VITE_*` variables are baked into the public bundle. Only ever put
non‑secret values here — never a password, token, or connection string.

If `VITE_API_BASE_URL` is unset the bundle falls back to relative `/api`
paths (correct for local dev, wrong for the split deployment), so make sure
it is set before the production build.

---

## 4. Wire the two origins together

1. Deploy `worktruth-api` first; note its URL.
2. Deploy `worktruth-web` with `VITE_API_BASE_URL` = that API URL.
3. Set `CORS_ORIGIN` on `worktruth-api` = the web URL, and let it redeploy.
4. Open the web URL, log in with the `SEED_OFFICER_*` credentials.

Custom domains: add them in Render, then add each extra frontend origin to
`CORS_ORIGIN` (comma‑separated) and repoint `VITE_API_BASE_URL` if the API
domain changes.

---

## 5. What changed in the code for deployment

Minimal, behaviour‑preserving:

| File | Change |
|---|---|
| `artifacts/api-server/src/index.ts` | bind explicit `0.0.0.0` (`HOST` overridable); warn if `EVIDENCE_UPLOAD_DIR` unset in production |
| `artifacts/api-server/src/app.ts` | `CORS_ORIGIN` now accepts a comma‑separated list; unchanged permissive fallback for local dev |
| `artifacts/api-server/src/lib/auth.ts` | new `sessionCookieOptions()` — `SameSite=None; Secure` when `CORS_ORIGIN` is set (cross‑origin deploy), `SameSite=Lax` otherwise (local); `httpOnly` always |
| `artifacts/api-server/src/routes/worktruth.ts` | login/logout use `sessionCookieOptions()` |
| `artifacts/api-server/src/lib/worktruth.ts` | `ensureSeeded()` skips the demo‑project dataset when `NODE_ENV=production` (unless `SEED_DEMO_DATA=true`); the officer account is still provisioned |
| `lib/api-client-react/src/custom-fetch.ts` | `fetch` now sends `credentials: "include"` (needed for the cross‑origin cookie; no effect same‑origin) |
| `artifacts/worktruth/src/main.tsx` | calls `setBaseUrl(VITE_API_BASE_URL)` when set |
| `artifacts/worktruth/src/vite-env.d.ts` | new — types `VITE_API_BASE_URL` |
| `artifacts/worktruth/vite.config.ts` | unchanged — local `/api` proxy kept |
| root `package.json` | `packageManager`, `engines`, and `build:api` / `build:frontend` / `start:api` scripts |
| `.node-version`, `render.yaml` | new |

Local development is unchanged: `pnpm db:up && pnpm db:setup && pnpm dev`.

---

## 6. Quick reference

- **Frontend build command:** `pnpm install --frozen-lockfile && pnpm run build:frontend`
- **Frontend publish dir:** `artifacts/worktruth/dist/public`
- **API build command:** `pnpm install --frozen-lockfile && pnpm run build:api`
- **API start command:** `pnpm run start:api`
- **Health check path:** `/api/healthz`
- **Database schema init:** `DATABASE_URL=<external url> pnpm db:push`
- **Evidence disk mount:** `/var/data` → env `EVIDENCE_UPLOAD_DIR=/var/data/uploads`

### Required environment variables

**API service** — `NODE_ENV=production`, `DATABASE_URL`, `EVIDENCE_UPLOAD_DIR=/var/data/uploads`, `CORS_ORIGIN`, `SEED_OFFICER_EMAIL`, `SEED_OFFICER_PASSWORD` (+ optional `SEED_OFFICER_NAME`). `PORT` is provided by Render.

**Static site** — `VITE_API_BASE_URL` (build time).

---

## 7. Remaining blockers / caveats

- **Schema init is manual.** Run `pnpm db:push` against the new database once
  (and after each schema change). Render's free tier has no pre‑deploy hook;
  on a paid plan you may set a Pre‑Deploy Command of `pnpm db:push`.
- **Single API instance only** while evidence lives on a persistent disk. Not
  a blocker for launch; object storage is the eventual fix.
- **Free tiers sleep / expire.** Free web services cold‑start after inactivity
  (health check may need a retry); free Postgres is deleted after 30 days.
- **First request after deploy** does the officer‑account provisioning and is
  slightly slower.
- **Database SSL:** use the **Internal** `DATABASE_URL` for the API service —
  it needs no SSL config and `node-postgres` connects to it as‑is. The
  External URL (used for `pnpm db:push` from your laptop) carries its own
  `sslmode` parameter, also handled automatically. No code change needed.
- No automated end‑to‑end deploy test was run here (no Render account in this
  environment). Verified locally: typecheck, 178 API tests, the production
  frontend build (with and without `VITE_API_BASE_URL`), the bundled API boot
  on `0.0.0.0`, `/api/healthz` = 200, and credentialed CORS for configured vs.
  rejected origins.
