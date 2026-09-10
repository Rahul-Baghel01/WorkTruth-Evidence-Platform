// Import this FIRST (before any module that transitively imports
// @workspace/db) in test files that only exercise pure, DB-independent
// functions. @workspace/db throws eagerly if DATABASE_URL is unset, which
// would otherwise block importing pure helpers from a module that also
// exports DB-backed functions (e.g. financial-engine.ts). This placeholder
// is never used for an actual connection — no query runs in these tests.
process.env.DATABASE_URL ??= "postgres://test:test@localhost:5432/test";
