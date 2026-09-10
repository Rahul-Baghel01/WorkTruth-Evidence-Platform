import express, { type Express, type ErrorRequestHandler } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
// Permissive by default — safe for local development, where the Vite dev
// proxy (see artifacts/worktruth/vite.config.ts) makes every browser
// request to /api same-origin anyway, so this setting never actually comes
// into play there. In any environment where the frontend and API are
// genuinely served from different origins, set CORS_ORIGIN to the
// frontend's exact origin (e.g. https://worktruth.example.gov) rather than
// leaving this wildcard-permissive.
// CORS_ORIGIN: the exact origin(s) the browser frontend is served from, when
// it is a different origin than this API (e.g. a Render Static Site calling a
// Render Web Service). Comma-separate to allow more than one (custom domain +
// the *.onrender.com URL, say). `credentials: true` is required for the
// session cookie to survive a cross-origin request — which is also why the
// origin must be explicit here and can never be the "*" wildcard.
// Unset (local dev): stays permissive — the Vite proxy already makes every
// browser request to /api same-origin, so CORS never comes into play there.
const corsOrigin = process.env.CORS_ORIGIN?.split(",").map((o) => o.trim()).filter(Boolean);
app.use(corsOrigin?.length ? cors({ origin: corsOrigin, credentials: true }) : cors());
app.use(cookieParser());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/api", router);

// Any /api path that didn't match a route above — a clean JSON 404 instead
// of Express's default HTML "Cannot GET ..." page.
app.use("/api", (_req, res) => {
  res.status(404).json({ error: "Not found" });
});

// Centralized error handler (P0-N) — Express 5 forwards a rejected promise
// from any async route handler here automatically. Without this, Express's
// own default error handler renders an HTML page that includes the raw
// stack trace whenever NODE_ENV isn't exactly "production" — visible to
// any client, including the browser (this is genuinely what a database-
// unavailable error looked like before this handler existed). This always
// logs the full error server-side and always returns a clean, generic JSON
// error to the client — never a stack trace, never swallowed silently.
const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  (req.log ?? logger).error({ err }, "Unhandled request error");
  if (res.headersSent) return;
  res.status(500).json({ error: "Internal server error" });
};
app.use(errorHandler);

export default app;
