# Deploying WorkTruth to Vercel

This guide deploys the existing WorkTruth application (the React frontend and the Express API) as **one Vercel project on one domain**. The analysis engines, database schema, authentication, guest mode and officer workflow are unchanged.

The Render deployment (`render.yaml`, [DEPLOYMENT.md](DEPLOYMENT.md)) is still in the repository and still works. Remove it only after the Vercel deployment has been verified.

---

## 1. Architecture

```text
https://<your-project>.vercel.app
│
├── /, /projects/…, /login, …    → static SPA  (artifacts/worktruth/dist/public, index.html fallback)
├── /evidence/hero-*.png         → static demo photographs (committed files, permanent)
├── /assets/*                    → static JS/CSS bundles
└── /api/*                       → one Vercel Node.js function: api/index.mjs
                                      └── the existing Express app (artifacts/api-server/src/app.ts)
                                            └── PostgreSQL via DATABASE_URL
```

- **Same origin.** The browser calls relative `/api/...` paths on the same domain. That means no CORS, no `VITE_API_BASE_URL`, and a first-party `HttpOnly; Secure; SameSite=Lax` session cookie.
- **No `app.listen()` on Vercel.** `artifacts/api-server/src/app.ts` builds the Express app and never listens. The build bundles it to `artifacts/api-server/dist/app.mjs`. `api/index.mjs` re-exports it as the function handler, and Vercel passes each request straight to Express, so every existing route, middleware and error handler runs unchanged.
- **`src/index.ts` is unchanged.** It still calls `app.listen()` for local development (`pnpm dev`) and for Render.

### What changed for Vercel

| File | Change |
|---|---|
| `vercel.json` | New. Install and build commands, output directory, function settings, `/api/*` → function rewrite, SPA fallback |
| `api/index.mjs` | New. Vercel function entrypoint that re-exports the Express app |
| `artifacts/api-server/build.mjs` | Also bundles `src/app.ts` → `dist/app.mjs`, alongside the existing `dist/index.mjs` |
| `artifacts/api-server/src/lib/storage.ts` | On Vercel (`VERCEL=1`) with no `EVIDENCE_UPLOAD_DIR`, uploads go to the OS temp dir instead of the read-only bundle directory |
| `.env.example` | Vercel notes added |
| `.gitignore` | Ignores `.vercel/` |

No routes, engines, schema, authentication or seed logic were changed.

---

## 2. Prerequisites

- A Vercel account connected to GitHub, with access to `Rahul-Baghel01/WorkTruth-Evidence-Platform`.
- A PostgreSQL database reachable from the internet over TLS. **Neon**, added through the Vercel Marketplace (Storage → Neon), is the simplest option: it injects `DATABASE_URL` for you and its certificate is publicly trusted.
  - The API's `pg` pool takes TLS settings only from the connection string. Use a URL containing `sslmode=require` from a provider whose certificate chain Node trusts by default.
  - Don't use the Render free-tier database as the long-term production database. It expires about 30 days after creation.
- Locally: Node.js ≥ 22.9, pnpm, and a clone of this repository with `pnpm install` done. You'll run the one-time schema and seed steps from your own machine.

---

## 3. Create and initialise the database (once)

### 3.1 Create the database

For example, create a Neon project and database. Copy two connection strings:

- The **pooled** URL (the host contains `-pooler`). Use this for `DATABASE_URL` in Vercel.
- The **direct** (non-pooled) URL. Use this for the one-time migrate and seed commands below.

Both must end with `?sslmode=require`.

### 3.2 Apply the schema: `pnpm db:migrate`

Run this deliberately, from your machine. **It is not part of the Vercel build.**

```bash
# bash / Git Bash
DATABASE_URL="postgresql://USER:PASSWORD@HOST/DB?sslmode=require" pnpm db:migrate
```

```powershell
# PowerShell
$env:DATABASE_URL = "postgresql://USER:PASSWORD@HOST/DB?sslmode=require"
pnpm db:migrate
Remove-Item Env:DATABASE_URL
```

`db:migrate` (`lib/db/src/migrate.ts`) applies the committed SQL in `lib/db/drizzle/`. That SQL matches the current Drizzle schema exactly; `drizzle-kit generate` reports *"No schema changes"*.

- It records what it has applied in `public.__worktruth_migrations`, so running it again does nothing.
- It never drops, truncates or resets anything.
- It never creates a schema.

> ⚠️ Never run `pnpm db:reset`, `pnpm db:push` or `pnpm --filter @workspace/db run push-force` with a production `DATABASE_URL`. `db:reset` is meant for the local Docker database only.

### 3.3 Seed the officer account and demo data: `pnpm db:seed`

Run this **once**, from your machine:

```bash
# bash / Git Bash — every value explicit, so nothing is taken from your local .env
DATABASE_URL="postgresql://USER:PASSWORD@HOST/DB?sslmode=require" \
SEED_DEMO_DATA=true \
SEED_OFFICER_EMAIL="officer@your-domain.example" \
SEED_OFFICER_NAME="Duty Officer" \
SEED_OFFICER_PASSWORD="<strong password>" \
pnpm db:seed
```

```powershell
# PowerShell
$env:DATABASE_URL = "postgresql://USER:PASSWORD@HOST/DB?sslmode=require"
$env:SEED_DEMO_DATA = "true"
$env:SEED_OFFICER_EMAIL = "officer@your-domain.example"
$env:SEED_OFFICER_NAME = "Duty Officer"
$env:SEED_OFFICER_PASSWORD = "<strong password>"
pnpm db:seed
"DATABASE_URL","SEED_DEMO_DATA","SEED_OFFICER_EMAIL","SEED_OFFICER_NAME","SEED_OFFICER_PASSWORD" | ForEach-Object { Remove-Item "Env:$_" }
```

> **Why set every variable explicitly?** `pnpm db:seed` also loads your local `.env`. Variables already set in the shell take precedence, but anything you *don't* set is read from `.env`. If you leave out `SEED_OFFICER_*` or `SEED_ADMIN_*`, your *local* credentials would be provisioned into the production database. Use the same `SEED_OFFICER_*` values you'll enter in Vercel (§4.3).

What seeding does:

- **Accounts.** It creates the officer account (and the optional admin account, if `SEED_ADMIN_*` is set) and the read-only guest account.
- **Demo data.** Only if the projects table is empty, it creates the **23 synthetic demo projects**. These include the hero case P-1089 and its source project P-3022, with their ledgers, progress reports and evidence-image rows, and it runs the full analysis for each one.
- **Deterministic results.** Everything is generated deterministically, so the hero case always produces the same hashes and the same computed result.
- **Local image files are a side effect.** Seeding also writes the seed images into your *local* `artifacts/api-server/uploads/` (gitignored). That doesn't matter: in production the hero photos are served as static files, and the other seed images are regenerated byte-for-byte on demand from their deterministic generator (see §6).
- **Safe to repeat.** Running it again does nothing if nothing changed. Accounts are created or have their password rotated; projects are skipped once the table is non-empty.

---

## 4. Create the Vercel project

### 4.1 Import

1. Go to **Vercel → Add New… → Project → Import** `Rahul-Baghel01/WorkTruth-Evidence-Platform`.
2. Set **Root Directory** to `./` (the repository root). **Do not** choose `artifacts/worktruth`: the function in `api/` and the pnpm workspace both live at the root.
3. Set **Framework Preset** to **Other**. `vercel.json` sets `"framework": null`.
4. Leave **Build, Install and Output settings** without overrides. `vercel.json` defines them:

   | Setting | Value (from `vercel.json`) |
   |---|---|
   | Install Command | `pnpm install --frozen-lockfile --prod=false` |
   | Build Command | `pnpm run build:api && pnpm run build:frontend` |
   | Output Directory | `artifacts/worktruth/dist/public` |

   `--prod=false` matters. `NODE_ENV=production` must be set for the runtime (§4.3), and without this flag pnpm would skip devDependencies (Vite, esbuild, TypeScript) during the build. This was checked locally: with `NODE_ENV=production`, the flag keeps devDependencies installed.

### 4.2 Node.js version

In **Project Settings → General → Node.js Version**, choose **22.x** to match `.node-version`. The root `package.json` declares `"engines": { "node": ">=22.9.0" }`. With an open-ended range like this, Vercel may pick a newer major version and show a warning; that is harmless.

### 4.3 Environment variables

Set these in **Project Settings → Environment Variables**, for the **Production** environment. For **Preview**, use a separate database branch or URL, so preview deployments never write to production data.

| Variable | Value | Required |
|---|---|---|
| `DATABASE_URL` | Pooled PostgreSQL URL with `?sslmode=require`. Injected automatically if you use the Neon integration. | **Yes** |
| `NODE_ENV` | `production` | **Yes**. Makes the session cookie `Secure`, switches logs to JSON, and turns off runtime demo seeding. |
| `SEED_OFFICER_EMAIL` | The officer login email (the same as in §3.3) | **Yes** |
| `SEED_OFFICER_PASSWORD` | The officer password (the same as in §3.3). Mark it **Sensitive**. | **Yes** |
| `SEED_OFFICER_NAME` | For example, `Duty Officer` | Recommended |
| `SEED_DEMO_DATA` | `false` | Recommended. Makes explicit that serverless instances never seed demo data. |
| `ENABLE_EXPERIMENTAL_COREPACK` | `1` | Recommended. Makes Vercel use the exact `pnpm@10.4.1` pinned in `package.json`. |
| `SEED_ADMIN_EMAIL` / `SEED_ADMIN_NAME` / `SEED_ADMIN_PASSWORD` | A first admin account | Optional |
| `GUEST_DEMO_ENABLED` | `true` (the default) or `false` | Optional. `false` turns off *Explore demo*. |
| `GUEST_DEMO_EMAIL` / `GUEST_DEMO_NAME` | Guest account identity | Optional |
| `LOG_LEVEL` | For example, `info` or `warn` | Optional |

**Leave these unset on Vercel:**

| Variable | Why |
|---|---|
| `VITE_API_BASE_URL` | The frontend and API share one domain, so relative `/api` paths are correct. If set, it's inlined into the bundle at build time and sends API calls elsewhere. |
| `CORS_ORIGIN` | CORS doesn't apply to same-origin requests. Setting it would switch the cookie to `SameSite=None` for no reason. |
| `EVIDENCE_UPLOAD_DIR` | The API falls back to the OS temp dir automatically (see §6). |
| `PORT`, `HOST` | Used only by `app.listen()`, which doesn't run on Vercel |
| `DATABASE_SSL` | Only read by `pnpm db:migrate` on your machine |
| `SESSION_SECRET` | Not used anywhere |

Never commit real values. `.env` is gitignored, and `.env.example` contains placeholders only.

---

## 5. Deploy

- **From Git.** Push to the production branch (`main`). Vercel builds and deploys automatically. Pull requests get Preview deployments.
- **From the CLI** (optional):

  ```bash
  npm i -g vercel
  vercel link          # once — creates .vercel/ (gitignored)
  vercel pull          # fetch project settings + env for a local build
  vercel build --prod  # optional pre-flight: reproduces Vercel's build locally
  vercel deploy --prebuilt --prod
  ```

The build does **not** migrate or seed the database. Schema and seed changes are always intentional, manual steps (§3).

---

## 6. Filesystem and evidence images

Vercel functions have a **read-only** filesystem, except for a small per-instance temporary directory that is **not persistent**. WorkTruth handles its two kinds of image separately:

### A. Permanent demo evidence: static assets

- The two hero-case photographs are committed at `artifacts/worktruth/public/evidence/` and served by Vercel's CDN:
  - `/evidence/hero-current.png`
  - `/evidence/hero-matched.png`
- They don't depend on `/tmp`, on `EVIDENCE_UPLOAD_DIR`, on the function filesystem, or on a session cookie. The frontend loads rows marked `seed_demo_static` from these URLs.
- They stay **PNG** rather than JPEG on purpose. The SHA-256 and perceptual hash stored for these evidence rows were computed over these exact PNG bytes. Re-encoding them as JPEG would change the bytes, and the photo shown would no longer be the one that was hashed.
- The other seeded demo images (`seed_demo`) are served through the authenticated API route. When their file isn't found, which is always the case on Vercel, the route regenerates the identical bytes from the deterministic generator. Their stored hashes therefore still match.

### B. Dynamic officer uploads: temporary only

- The upload pipeline is unchanged: multer, file-type and size checks, decoding, SHA-256, perceptual hash, and EXIF GPS and capture date.
- On Vercel, files are written to `<os temp dir>/worktruth-evidence/`. This was tested locally with `VERCEL=1`: upload, read back and delete all worked.
- **This storage is not persistent.** A file may be missing after the instance is recycled, or when a later request is served by a different instance. When that happens, the image-file route returns **404 "Stored file not found"**. It never substitutes a different image.
- The evidence row itself (hashes, GPS, capture date) is stored in PostgreSQL. The visual, geospatial and temporal engines keep working from it after the file is gone.
- **Request body limit.** Vercel limits function request bodies to **4.5 MB**. Uploads larger than that are rejected by the platform with HTTP 413 before they reach the API, even though the API itself allows up to 10 MB.
- **For durable uploads,** implement the existing `EvidenceStorage` interface in `storage.ts` with an object store such as Vercel Blob or S3. That hasn't been done in this migration.

---

## 7. Runtime behaviour worth knowing

- **Seeding at runtime.** With `NODE_ENV=production` and `SEED_DEMO_DATA` unset or `false`, the request-time `ensureSeeded()` call only provisions accounts: the officer, the optional admin and the guest. This is idempotent and never inserts demo projects. Running §3.3 first means the accounts already exist before the first request.
- **Database connections.** Each function instance keeps its own `pg` pool (default maximum of 10 connections). Use the provider's **pooled** connection string for `DATABASE_URL`, so concurrent instances don't exhaust the database's connection limit.
- **Function limits.** `maxDuration` is 30 s (set in `vercel.json`). A full analysis re-run for one project is well within that.
- **Cold starts.** The first request on a new instance loads the approximately 4 MB API bundle and computes one scrypt hash at start-up, which adds some latency.

---

## 8. Verify the deployment

Replace `$APP` with your deployment URL, for example `https://worktruth-xxxxx.vercel.app`.

```bash
curl -s $APP/api/healthz                 # {"status":"ok","database":"ok"}   (503 "degraded" = DB unreachable)
curl -sI $APP/evidence/hero-current.png  # 200, content-type: image/png
curl -sI $APP/projects/P-1089            # 200 (SPA fallback to index.html)
curl -s  $APP/api/auth/session           # 401 {"error":"Unauthorized"}
```

Then in a browser:

| Check | Expected |
|---|---|
| Log in with the `SEED_OFFICER_*` credentials | Dashboard loads. DevTools shows the `worktruth_session` cookie as `HttpOnly`, `Secure`, `SameSite=Lax`. |
| Wrong password | *Invalid email or password* |
| Open `/projects` | 23 demo projects, with **P-1089 at the top as CRITICAL** |
| Open P-1089 | Hero photo and matched photo both display, the cross-project match against P-3022 is shown, the why-trail lists the pre-sanction expenditure |
| *Re-run analysis* on P-1089 | Succeeds (HTTP 202) and the priority is still CRITICAL |
| Record a review status and notes | The entry appears in the investigation history with your name |
| Open `/admin/users` as the officer | Redirected. The API itself returns 403. |
| Log out, then choose *Explore demo* | A read-only guest session with the *DEMO MODE · READ ONLY* badge |
| As the guest, try any change | Rejected with *This account has read-only access.* (HTTP 403) |
| Refresh the browser on a deep link such as `/projects/P-1089` | The page loads (no 404) |

The same checks were run locally against the Vercel entrypoint (`api/index.mjs` loaded by a plain Node HTTP server, `NODE_ENV=production`, `VERCEL=1`, local PostgreSQL), and every one returned the expected result. The only step not reproducible locally is Vercel's own build and function packaging; `vercel build` (§5) runs that as a pre-flight.

---

## 9. Rollback

- **A bad Vercel deployment.** In **Vercel → Deployments**, pick the last good deployment and choose **Instant Rollback** (or **Promote to Production**). No rebuild is needed.
- **Reverting the migration entirely.** Render is untouched. `render.yaml` and the Render services still work, so point users back at the Render URL. Remove the Vercel project only once you no longer need it.
- **Database.** The migration made no schema changes, so there is nothing to roll back. If the demo data needs to be restored, don't reset the production database. Delete and re-seed deliberately, or restore from your provider's backup or branch feature (Neon supports point-in-time branches).

---

## 10. Troubleshooting

| Symptom | Likely cause and fix |
|---|---|
| Build fails with `vite: not found` or `esbuild` missing | An install-command override in the Vercel UI dropped `--prod=false`. Remove the override so `vercel.json` applies. |
| `/api/*` returns Vercel's 404 page | The Root Directory isn't the repo root, or `vercel.json` rewrites were overridden |
| `/api/healthz` returns 503 `degraded` | `DATABASE_URL` is wrong or unreachable, or `sslmode=require` is missing |
| Function crash: *"DATABASE_URL must be set"* | The variable isn't set for this environment (Production or Preview) |
| `self-signed certificate` or other TLS errors at runtime | The provider's certificate isn't trusted by Node's default CA store. Use a provider with a publicly trusted certificate, such as Neon. |
| Login always fails | `SEED_OFFICER_*` differ from what was seeded. The next request re-provisions from the Vercel values, rotating only the password. Also check that `NODE_ENV=production` is set, because `Secure` cookies require HTTPS. |
| The frontend calls a different domain | `VITE_API_BASE_URL` is set in Vercel. Unset it and redeploy (it's applied at build time). |
| An uploaded image later shows as missing | Expected on Vercel: uploads are temporary (§6B) |
| Upload fails with 413 | The file is larger than Vercel's 4.5 MB request limit |
