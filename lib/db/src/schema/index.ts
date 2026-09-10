import {
  date,
  index,
  integer,
  jsonb,
  pgTable,
  real,
  serial,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const usersTable = pgTable("worktruth_users", {
  id: serial("id").primaryKey(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  role: text("role").notNull(),
  passwordHash: text("password_hash").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// Opaque server-side sessions. The cookie carries only the random token —
// all session state (who, when it expires) lives here so logout and expiry
// are real, immediate, and revocable (unlike a self-contained JWT).
export const sessionsTable = pgTable(
  "worktruth_sessions",
  {
    token: text("token").primaryKey(),
    userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (table) => [index("worktruth_sessions_user_idx").on(table.userId)],
);

export const importBatchesTable = pgTable("worktruth_import_batches", {
  id: serial("id").primaryKey(),
  sourceFilename: text("source_filename").notNull(),
  acceptedCount: integer("accepted_count").notNull().default(0),
  rejectedCount: integer("rejected_count").notNull().default(0),
  qualityScore: real("quality_score").notNull().default(0),
  rowErrors: jsonb("row_errors"),
  importedAt: timestamp("imported_at", { withTimezone: true }).notNull().defaultNow(),
});

export const projectsTable = pgTable(
  "worktruth_projects",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    category: text("category").notNull(),
    district: text("district").notNull(),
    state: text("state").notNull(),
    location: text("location").notNull(),
    sanctionAmount: integer("sanction_amount").notNull(),
    expenditure: integer("expenditure").notNull(),
    progress: integer("progress").notNull(),
    evidenceQuality: integer("evidence_quality").notNull(),
    // Source/import provenance ONLY (e.g. a demo-seed or register-import
    // value) — kept for reference, never read by any computation. The real,
    // evidence-derived Verification Priority an officer sees is computed by
    // verification-priority-engine.ts (P0-L) from that project's persisted
    // analysis and exposed as `Project.priority`/`AnalysisBundle.risk.priority`
    // in the API; this column never overrides either.
    priority: text("priority").notNull(),
    // Source/import provenance ONLY — the demo seed data's original static
    // narrative strings (e.g. "High cost + similar photograph"). Never read
    // by any computation and never surfaced to an officer as a finding
    // (P0-M). The real, evidence-derived primary finding an officer sees is
    // computed by verification-priority-engine.ts from that project's
    // persisted analysis and exposed as `Project.primaryFinding`/
    // `AnalysisBundle.risk.primaryFinding` in the API; this column never
    // overrides either. Kept only so the seed dataset's original demo
    // narrative remains inspectable, the same way `priority` above does.
    primaryFlag: text("primary_flag").notNull(),
    latitude: real("latitude").notNull(),
    longitude: real("longitude").notNull(),
    startDate: date("start_date", { mode: "string" }).notNull(),
    expectedCompletion: date("expected_completion", { mode: "string" }).notNull(),
    actualCompletion: date("actual_completion", { mode: "string" }),
    description: text("description").notNull(),
    contractor: text("contractor").notNull(),
    // Provenance: distinguishes demo-seeded rows from real manual/imported
    // records so demo data can never silently pass as real evidence.
    source: text("source").notNull().default("manual"),
    importBatchId: integer("import_batch_id").references(() => importBatchesTable.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("worktruth_projects_category_district_idx").on(table.category, table.district),
    index("worktruth_projects_import_batch_idx").on(table.importBatchId),
  ],
);

// Dated financial ledger. Supplements (does not replace) the summary
// sanctionAmount/expenditure scalars on projectsTable, which the existing
// API contract and UI already depend on directly. Populated once real
// register/ledger data is ingested — empty for a project means "no ledger
// detail available," not zero financial activity.
export const financialRecordsTable = pgTable(
  "worktruth_financial_records",
  {
    id: serial("id").primaryKey(),
    projectId: text("project_id").notNull().references(() => projectsTable.id, { onDelete: "cascade" }),
    type: text("type").notNull(), // "SANCTION" | "EXPENDITURE" | "PAYMENT"
    amount: integer("amount").notNull(),
    recordedDate: date("recorded_date", { mode: "string" }).notNull(),
    reference: text("reference"),
    source: text("source").notNull().default("manual"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("worktruth_financial_records_project_date_idx").on(table.projectId, table.recordedDate)],
);

// Evidence photographs. GPS/capture-time columns are nullable by design —
// when a photo carries no EXIF GPS, that must read as "no data," never a
// synthesized coordinate.
export const evidenceImagesTable = pgTable(
  "worktruth_evidence_images",
  {
    id: serial("id").primaryKey(),
    projectId: text("project_id").notNull().references(() => projectsTable.id, { onDelete: "cascade" }),
    storageKey: text("storage_key").notNull(),
    originalFilename: text("original_filename"),
    mimeType: text("mime_type"),
    fileSizeBytes: integer("file_size_bytes"),
    width: integer("width"),
    height: integer("height"),
    capturedAt: timestamp("captured_at", { withTimezone: true }),
    gpsLatitude: real("gps_latitude"),
    gpsLongitude: real("gps_longitude"),
    gpsAccuracyMeters: real("gps_accuracy_meters"),
    perceptualHash: text("perceptual_hash"),
    // SHA-256 of the exact uploaded bytes (hex) — detects exact binary
    // duplicates. Distinct from perceptualHash, which detects visually
    // similar images even when the bytes differ. Added in P0-I alongside
    // the upload pipeline that's the first thing to ever populate this
    // table's rows.
    sha256: text("sha256"),
    label: text("label"),
    source: text("source").notNull().default("manual"),
    uploadedAt: timestamp("uploaded_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("worktruth_evidence_images_project_idx").on(table.projectId),
    index("worktruth_evidence_images_sha256_idx").on(table.projectId, table.sha256),
  ],
);

// Dated progress reports. Replaces the need to synthesize a fake timeline
// from a single current progress number — empty means "no history reported,"
// which the temporal engine must surface as insufficient evidence.
export const progressRecordsTable = pgTable(
  "worktruth_progress_records",
  {
    id: serial("id").primaryKey(),
    projectId: text("project_id").notNull().references(() => projectsTable.id, { onDelete: "cascade" }),
    reportDate: date("report_date", { mode: "string" }).notNull(),
    progressPercent: integer("progress_percent").notNull(),
    note: text("note"),
    source: text("source").notNull().default("manual"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("worktruth_progress_records_project_date_idx").on(table.projectId, table.reportDate)],
);

// Append-only analysis history, alongside (not instead of) the existing
// projectAnalysesTable singleton. The singleton stays the "current result"
// the API already reads/writes with zero contract changes; this table is
// purely for reproducibility/audit — what ran, when, and with what engine
// version.
export const analysisRunsTable = pgTable(
  "worktruth_analysis_runs",
  {
    id: serial("id").primaryKey(),
    projectId: text("project_id").notNull().references(() => projectsTable.id, { onDelete: "cascade" }),
    status: text("status").notNull(),
    payload: jsonb("payload").notNull(),
    engineVersion: text("engine_version").notNull().default("deterministic-demo-v1"),
    triggeredBy: text("triggered_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("worktruth_analysis_runs_project_created_idx").on(table.projectId, table.createdAt)],
);

export const projectAnalysesTable = pgTable("worktruth_project_analyses", {
  projectId: text("project_id").primaryKey().references(() => projectsTable.id, { onDelete: "cascade" }),
  status: text("status").notNull(),
  payload: jsonb("payload").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const investigationsTable = pgTable("worktruth_investigations", {
  projectId: text("project_id").primaryKey().references(() => projectsTable.id, { onDelete: "cascade" }),
  status: text("status").notNull(),
  notes: text("notes").notNull().default(""),
  decision: text("decision").notNull().default(""),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const investigationNotesTable = pgTable("worktruth_investigation_notes", {
  id: serial("id").primaryKey(),
  projectId: text("project_id").notNull().references(() => projectsTable.id, { onDelete: "cascade" }),
  status: text("status").notNull(),
  note: text("note").notNull(),
  // Display-name snapshot at write time (resilient to a user's name changing
  // or the account being removed later). The canonical link is userId below;
  // userId is nullable so legacy/pre-auth rows are never silently reattributed
  // to a real account — they just have no owning user.
  officer: text("officer").notNull(),
  userId: integer("user_id").references(() => usersTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertProjectSchema = createInsertSchema(projectsTable).omit({ createdAt: true });
export const insertInvestigationSchema = createInsertSchema(investigationsTable).omit({ updatedAt: true });
export type ProjectRow = typeof projectsTable.$inferSelect;
export type ProjectInsert = z.infer<typeof insertProjectSchema>;
export type EvidenceImageRow = typeof evidenceImagesTable.$inferSelect;
export type InvestigationRow = typeof investigationsTable.$inferSelect;