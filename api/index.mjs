// Vercel Node.js function entrypoint for the WorkTruth API.
//
// Vercel does not run a long-lived `app.listen()` server. Instead, every
// request that vercel.json rewrites to /api is handed to this module's
// default export. An Express app is itself a (req, res) handler, so the
// existing app is exported unchanged — every route, middleware, the auth
// layer, and the error handler are exactly the ones local development uses.
//
// `dist/app.mjs` is produced by `pnpm run build:api` (see
// artifacts/api-server/build.mjs), which vercel.json's buildCommand runs
// before Vercel packages this function. It bundles src/app.ts, which never
// calls listen(); src/index.ts (with listen()) remains the local entry.
import app from "../artifacts/api-server/dist/app.mjs";

export default app;
