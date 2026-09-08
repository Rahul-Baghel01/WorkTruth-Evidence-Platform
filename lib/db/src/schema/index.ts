import {
  date,
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
});

export const projectsTable = pgTable("worktruth_projects", {
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
  priority: text("priority").notNull(),
  primaryFlag: text("primary_flag").notNull(),
  latitude: real("latitude").notNull(),
  longitude: real("longitude").notNull(),
  startDate: date("start_date", { mode: "string" }).notNull(),
  expectedCompletion: date("expected_completion", { mode: "string" }).notNull(),
  actualCompletion: date("actual_completion", { mode: "string" }),
  description: text("description").notNull(),
  contractor: text("contractor").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

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
  officer: text("officer").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertProjectSchema = createInsertSchema(projectsTable).omit({ createdAt: true });
export const insertInvestigationSchema = createInsertSchema(investigationsTable).omit({ updatedAt: true });
export type ProjectRow = typeof projectsTable.$inferSelect;
export type ProjectInsert = z.infer<typeof insertProjectSchema>;
export type InvestigationRow = typeof investigationsTable.$inferSelect;