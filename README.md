# WorkTruth

WorkTruth helps officers prioritize verification of public works by comparing project records, financial entries, dated progress reports, descriptions, and image evidence. It surfaces evidence inconsistencies for **human verification**. A Verification Priority is a review signal; it is neither a fraud probability nor a legal finding. The officer makes the final determination.

The bundled portfolio contains **23 synthetic demo projects**. It is marked **DEMO DATA · NOT OFFICIAL GOVERNMENT RECORDS** in the application. P-1089 is the seeded walkthrough case; P-3022 provides a comparable description and a matching image. Their evidence is analysed by the same engines as other projects. Computed scores and priority are never hardcoded for a project ID.

## Implemented analysis

| Lens | Inputs and method |
|---|---|
| Financial | Reconciles sanction and expenditure totals, checks payments, duplicate and invalid records, concentration, pre-sanction activity, and expenditure relative to sanctions. Compares comparable projects using medians, ratios, percentile rank, and median absolute deviation (MAD). |
| Geospatial | Validates declared and image GPS, compares locations using Haversine distance, measures geographic spread, and reports missing or invalid GPS separately. |
| Visual | Computes SHA-256 and 64-bit perceptual hashes (pHash) for exact and near-duplicate evidence, including reuse across projects. Extracts EXIF capture date and GPS where available. It does not identify image content or assess construction progress from pixels. |
| Text | Uses deterministic TF-IDF vectors and cosine similarity to compare descriptions, plus category keyword checks. This is lexical comparison, not a trained language model or semantic embedding. |
| Temporal | Checks project, financial, progress, and image dates for invalid or future values, chronology conflicts, and abrupt progress changes. |

Each lens returns a separate anomaly score, evidence confidence, checks, and reasons. Unavailable evidence is reported as insufficient rather than scored as suspicious. All thresholds and the five base lens weights are heuristic and visible in the source.

The [cross-evidence engine](artifacts/api-server/src/lib/cross-modal-engine.ts) records structured inconsistencies across the lenses, with supporting checks and evidence references. The [fusion engine](artifacts/api-server/src/lib/fusion-engine.ts) combines usable lens scores with confidence-adjusted, renormalized weights. It accounts for independent-lens agreement, mixed evidence, and coverage. Cross-evidence findings are explained alongside fusion without double-counting their underlying facts in the fused score. The [priority engine](artifacts/api-server/src/lib/verification-priority-engine.ts) routes results to **LOW, MODERATE, HIGH, or CRITICAL** from the fusion output and inconsistency severity. The project detail's **Why Trail** traces the routing decision to the evidence.

### Reading the percentages

These are distinct measures. Values vary with the project and evidence.

| UI metric | Meaning |
|---|---|
| Financial anomaly score (for example 83%) | The financial lens's own score before weighting. |
| Financial contribution (for example 21%) | Percentage points the financial lens adds to the fused base signal: lens score × confidence-adjusted, renormalized effective weight. Lens contributions sum to the base signal before any agreement bonus. |
| Fused evidence signal (for example 23%) | Combined score from usable lenses plus any independent-lens agreement bonus. It is a verification signal. |
| Evidence confidence (for example 53%) | Confidence in that combined signal, based on usable evidence, lens confidence, coverage, agreement, and mixed evidence. |

The project register's recorded `evidenceQuality` field is distinct from computed fusion confidence. The dashboard's average evidence quality summarizes that **recorded field**. “Projects monitored” and the sidebar queue badge count all registered projects; “High / critical projects” counts only the HIGH and CRITICAL subset. Priority counts use the current computed analysis, not the legacy priority value stored with a seed or import. The default queue lists all projects in descending Verification Priority. The demo seed starts with 23 projects, but these counts change if the register changes.

## Product workflow

The React/Vite frontend shows a dashboard, verification queue, project detail, five evidence lenses, cross-evidence findings, fusion, priority, Why Trail, image matching, and investigation history. An officer can add or import projects, upload evidence, add dated progress, rerun analysis, record review status and a decision, and add notes. Review actions are preserved in the audit trail. CSV/XLSX import validates rows before writing. A schematic project atlas and current portfolio analytics provide additional views.

Sessions are backed by PostgreSQL. Passwords are hashed with scrypt; the session cookie is `HttpOnly`, `SameSite=Lax`, and `Secure` in production. The public **Explore demo** action creates a shared GUEST session. Guest and VIEWER roles are read-only: API mutation routes return 403 even if called directly. OFFICER and VERIFIER currently have the same mutation access; ADMIN also manages user accounts. No jurisdiction-specific access scope is enforced.

## Repository and deployment

| Path | Purpose |
|---|---|
| `artifacts/worktruth/` | Frontend and committed static hero images |
| `artifacts/api-server/` | Express API, seed, analysis engines, authentication, tests |
| `lib/db/` | Drizzle schema and committed SQL migrations |
| `lib/api-spec/`, `lib/api-zod/`, `lib/api-client-react/` | OpenAPI contract and generated server/client types |
| `api/index.mjs`, `vercel.json` | Vercel API function and same-origin deployment |
| `docker-compose.yml` | Local development PostgreSQL |

Production is **GitHub → Vercel frontend and `/api/*` Express function → Neon PostgreSQL**. The frontend calls relative `/api/*` paths. See [VERCEL_DEPLOYMENT.md](VERCEL_DEPLOYMENT.md) for environment setup, migrations, seeding, and production limits.

### Local setup

Install Node.js 22.9+, pnpm 10.4.1, and Docker. Copy `.env.example` to `.env`; set a local `POSTGRES_PASSWORD`, put the same password in the local `DATABASE_URL`, and set your own officer email and password. Never commit `.env`.

```powershell
pnpm install
pnpm db:up
pnpm db:migrate
pnpm db:seed
pnpm dev
```

The frontend's Vite server proxies `/api/*` to the local Express API. `pnpm db:reanalyze` refreshes saved analyses after evidence changes. Run `pnpm typecheck`, `pnpm test`, and `pnpm build` before release. `pnpm build:api` and `pnpm build:frontend` are the separate Vercel build steps.

| Environment variable | Use |
|---|---|
| `DATABASE_URL` | PostgreSQL connection; required by API and database commands |
| `POSTGRES_PASSWORD` | Local Docker PostgreSQL password; must match the local database URL |
| `NODE_ENV=production` | Secure cookie and production seeding defaults on Vercel |
| `SEED_OFFICER_EMAIL`, `SEED_OFFICER_PASSWORD` | Optional officer provisioning when both are supplied; needed for officer login |
| `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD` | Optional first admin provisioning |
| `SEED_DEMO_DATA=true` | Deliberate one-time demo portfolio seeding in production |
| `GUEST_DEMO_ENABLED=false` | Optional guest-mode disable switch |
| `DATABASE_SSL` | Optional migration TLS override; remote databases use TLS by default |
| `PORT`, `WEB_PORT`, `HOST` | Optional local server settings |
| `EVIDENCE_UPLOAD_DIR` | Optional local upload path; leave unset on Vercel |

## SIH demo walkthrough

1. Open the landing page, choose **Explore demo**, and point out the demo-data banner and read-only access.
2. View the dashboard's full project count, HIGH/CRITICAL subset, and current priority mix. Open the verification queue and select P-1089.
3. Show the financial comparison and pre-sanction expenditure; the perceptual image match against P-3022; GPS distance; spending against reported progress; and TF-IDF description similarity.
4. Show the five lens scores, cross-evidence inconsistencies, fused signal, confidence, Verification Priority, and Why Trail. Explain that these guide human review.
5. Sign out, sign in as a seeded officer, record a review status, decision, and note, and show the investigation history. Sign out and verify the guest session cannot submit the same mutations.

## Limits and Phase 2

The bundled data and hero images are synthetic. The scores use uncalibrated heuristics and have not been validated on official records. Missing EXIF/GPS, sparse peer groups, or thin ledgers reduce available evidence. Text matching is lexical and tokenizes Latin letters and digits. Analysis must be rerun after new evidence; it is not triggered automatically. The atlas is schematic. Vercel runtime uploads go to a temporary instance directory, so database metadata may outlive the file; only the committed hero images are durable in this deployment. The API's 10 MB image limit may also exceed Vercel's request size limit.

**Phase 2 / Future Scope, not implemented:** durable object storage; automatic reanalysis; historical priority trends; calibrated policies from reviewed outcomes; multilingual text analysis; notification workflows for new HIGH and CRITICAL projects; and jurisdiction-scoped roles (MP, state and ministry views).
