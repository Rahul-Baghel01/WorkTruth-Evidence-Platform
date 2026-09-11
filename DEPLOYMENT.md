# Deploying WorkTruth to Render

> **This is the fully‑Free tier deployment (initial SIH).** There is **no
> persistent disk** — Render does not allow disks on Free web services.
> Uploaded evidence files therefore sit on the API container's **ephemeral**
> filesystem and are **lost on every restart / redeploy**. Database rows
> persist (until the Free Postgres expires — see below). See §2 and §7.

WorkTruth deploys as **three** Render resources:

| Resource | Render type | Serves |
|---|---|---|
| `worktruth-web` | Static Site (Free) | the built frontend (`artifacts/worktruth`) |
| `worktruth-api` | Web Service (Free, no disk) | the Express API (`artifacts/api-server`) |
| `worktruth-db` | PostgreSQL (Free) | the Drizzle-managed database |

Uploaded evidence files are written to a plain directory inside the API
container (`EVIDENCE_UPLOAD_DIR`), not a mounted volume.

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
   `worktruth`, **plan Free**. Pick a region and reuse it for the API service.
2. Free Postgres **expires ~30 days after creation** and is then deleted with
   its data. Its rows persist normally until that point. Upgrade to a paid
   plan before this deployment needs to outlive the demo.
3. After it provisions, copy the **Internal Database URL** — that is
   `DATABASE_URL` for the API service (internal = same‑region, no egress).

### Initialise the schema (once, against the empty database)

The app never migrates automatically. From your machine, with the database's
**External** URL:

```bash
DATABASE_URL="postgresql://worktruth:...@...render.com/worktruth" pnpm db:migrate
```

**Use `pnpm db:migrate`, not `pnpm db:push`, against Render.** `db:push` (the
`drizzle-kit` CLI) introspects the live database's catalogs first to compute a
diff, and that introspection step is what has been observed to hang/error
against Render Postgres — independent of the schema itself. `db:migrate`
(`lib/db/src/migrate.ts`) is a small standalone `pg` script instead: it
applies the pre‑generated SQL in `lib/db/drizzle/` directly (no catalog
introspection, no `drizzle-kit`/`drizzle-orm` migrator involved at all), and
tracks what it already applied in its own `public."__worktruth_migrations"`
table, applying each migration's statements plus its tracking‑row insert in
one transaction — so it's safe to run again (already‑applied migrations are
skipped, nothing is re‑run or dropped, nothing existing is touched).
Deliberately **never** issues `CREATE SCHEMA` — Render's managed Postgres role
here can create tables in the pre‑existing `public` schema (all it needs —
see `lib/db/drizzle/0000_last_sauron.sql`) but not a brand‑new schema, which
is what made drizzle-orm's own built‑in migrator fail on this database (it
unconditionally creates a `drizzle` schema for its tracking table).
`pnpm db:push`/`push-force` still work for local development against the
docker‑compose database.

After any future schema change: `pnpm --filter @workspace/db run generate`
(writes a new file under `lib/db/drizzle/` — commit it), then `db:migrate`
against each target database.

> No demo data is inserted. `NODE_ENV=production` on the API stops the
> 20‑project demo dataset from ever being auto‑seeded (see §5).

---

## 2. API — `worktruth-api` (Web Service)

**New → Web Service**, connect this repo.

| Setting | Value |
|---|---|
| Root Directory | `.` (repo root — it is a pnpm workspace) |
| Runtime | Node |
| Plan | Free |
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

### Evidence storage (ephemeral on Free — no disk)

Render **does not permit a persistent disk on a Free web service**, so this
Blueprint attaches none. `EVIDENCE_UPLOAD_DIR` is set to `/tmp/worktruth-evidence`
— an ordinary writable directory **inside the container**:

- It is created automatically on the first upload.
- The path‑traversal / extension checks in
  `artifacts/api-server/src/lib/storage.ts` are unchanged — uploads stay
  confined to that root.
- **It is ephemeral.** Every deploy, every restart, and Render's periodic
  recycling of Free instances wipes it. Uploaded evidence images can and will
  disappear; database rows that reference them remain.

`EVIDENCE_UPLOAD_DIR` stays fully configurable and no disk path is baked into
the application. To make evidence durable later, without any code change:

1. Move `worktruth-api` to a paid plan.
2. Add a disk (`mountPath: /var/data`, e.g. 1 GB) — in `render.yaml` there is
   a commented `disk:` block ready to uncomment.
3. Change `EVIDENCE_UPLOAD_DIR` to `/var/data/uploads` and redeploy.

(A single disk also pins the API to one instance; the scale‑out path is
external S3‑compatible object storage — out of scope for the Free demo.)

### API environment variables

| Key | Value | Notes |
|---|---|---|
| `NODE_ENV` | `production` | Secure cookie; disables demo‑data auto‑seed |
| `DATABASE_URL` | *Internal Database URL of `worktruth-db`* | |
| `EVIDENCE_UPLOAD_DIR` | `/tmp/worktruth-evidence` | writable container dir; **ephemeral** on Free (no disk). Point at a disk mount path once one exists |
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
| Plan | Free |
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
| root `package.json` | `packageManager`, `engines`, `build:api` / `build:frontend` / `start:api` / `db:migrate` scripts |
| `lib/db/src/migrate.ts` | new — programmatic schema bootstrap (`pnpm db:migrate`), for when the `drizzle-kit` CLI itself fails against the target database (see §1) |
| `lib/db/drizzle/` | new — the generated SQL migration + metadata (`drizzle-kit generate`), committed so `db:migrate` has something to apply |
| `lib/db/package.json` | added `generate` / `migrate` scripts, `tsx` devDependency |
| `.node-version`, `render.yaml` | new (`render.yaml` = Free‑tier Blueprint: no disk, ephemeral evidence) |

Local development is unchanged: `pnpm db:up && pnpm db:setup && pnpm dev`.

---

## 6. Quick reference

- **Frontend build command:** `pnpm install --frozen-lockfile && pnpm run build:frontend`
- **Frontend publish dir:** `artifacts/worktruth/dist/public`
- **API build command:** `pnpm install --frozen-lockfile && pnpm run build:api`
- **API start command:** `pnpm run start:api`
- **Health check path:** `/api/healthz`
- **Database schema init:** `DATABASE_URL=<external url> pnpm db:migrate` (use `db:push` only for local dev — see §1)
- **Evidence storage (Free):** `EVIDENCE_UPLOAD_DIR=/tmp/worktruth-evidence` — ephemeral container directory, **no disk**. Paid upgrade → disk at `/var/data`, then `EVIDENCE_UPLOAD_DIR=/var/data/uploads`

### Required environment variables

**API service** — `NODE_ENV=production`, `DATABASE_URL`, `EVIDENCE_UPLOAD_DIR=/tmp/worktruth-evidence`, `CORS_ORIGIN`, `SEED_OFFICER_EMAIL`, `SEED_OFFICER_PASSWORD` (+ optional `SEED_OFFICER_NAME`). `PORT` is provided by Render.

**Static site** — `VITE_API_BASE_URL` (build time).

---

## 7. Remaining blockers / caveats

### Free‑tier data durability (read this)

- **Evidence files are ephemeral.** The Free deployment has **no persistent
  disk**. Uploaded evidence images live only on the API container's local
  filesystem and are **erased on every restart and every redeploy** (and when
  Render recycles the idle Free instance). Do not treat uploaded evidence as
  retained on the Free tier.
- **PostgreSQL data persists — for now.** Rows written to `worktruth-db`
  survive restarts and redeploys normally. However, **Render Free PostgreSQL
  expires roughly 30 days after it is created** and is then deleted along with
  all its data. Export anything you need before then, or upgrade the database
  to a paid plan.
- **Persistent evidence storage requires either** a paid Render plan with a
  mounted disk (uncomment the `disk:` block in `render.yaml`, set
  `EVIDENCE_UPLOAD_DIR=/var/data/uploads`) **or** external S3‑compatible object
  storage. No application code change is needed for the disk option.

### Other caveats

- **Schema init is manual.** Run `pnpm db:migrate` against the target database
  once (and after each future schema change — `generate` then `migrate`).
  Render's Free tier has no pre‑deploy hook; on a paid plan you may set a
  Pre‑Deploy Command of `pnpm db:migrate` instead of running it by hand.
  Prefer `db:migrate` over `db:push`/`drizzle-kit push|check|migrate` against
  Render — the `drizzle-kit` CLI's own introspection has been observed to
  hang/error there (see §1); `db:migrate` avoids that code path entirely.
- **Single API instance** (Free web services do not scale out anyway).
- **Free services sleep.** Free web services cold‑start after ~15 min idle, so
  the first request (and the Render health check) may need a retry.
- **First request after deploy** also does the officer‑account provisioning
  and is slightly slower.
- **Database SSL:** use the **Internal** `DATABASE_URL` for the API service —
  it needs no SSL config and `node-postgres` connects to it as‑is. The
  External URL (used for `pnpm db:push` from your laptop) carries its own
  `sslmode` parameter, also handled automatically. No code change needed.
- No automated end‑to‑end deploy test was run here (no Render account in this
  environment). Verified locally: typecheck, 178 API tests, the production
  frontend build (with and without `VITE_API_BASE_URL`), the bundled API boot
  on `0.0.0.0`, `/api/healthz` = 200, and credentialed CORS for configured vs.
  rejected origins.

> **Never paste a real connection string or password into this file** (or any
> tracked file). Set `DATABASE_URL` only in the Render dashboard / your shell
> session. For a one-off `pnpm db:push` from your machine, pass it inline for
> that command only and clear it afterwards.
