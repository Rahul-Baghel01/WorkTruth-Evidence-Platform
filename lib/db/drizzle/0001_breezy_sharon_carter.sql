ALTER TABLE "worktruth_users" ADD COLUMN "is_active" boolean DEFAULT true NOT NULL;
--> statement-breakpoint
-- Data migration, hand-added (drizzle-kit only diffs schema/DDL): the seed
-- officer's role was previously the free-text display string "District
-- Monitoring Officer". Admin user management (see
-- artifacts/api-server/src/lib/authorization.ts) introduces a closed role
-- set — ADMIN/OFFICER/VERIFIER/VIEWER — that authorization checks compare
-- against exactly, so any pre-existing row still holding the old string
-- would otherwise fail every role-gated check despite being a legitimate
-- officer account. Idempotent: a second run matches zero rows and is a
-- no-op. Never touches id, email, name, password_hash, is_active, or any
-- other role value (an admin-assigned role is never touched).
UPDATE "worktruth_users" SET "role" = 'OFFICER' WHERE "role" = 'District Monitoring Officer';
