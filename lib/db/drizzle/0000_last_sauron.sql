CREATE TABLE "worktruth_analysis_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"status" text NOT NULL,
	"payload" jsonb NOT NULL,
	"engine_version" text DEFAULT 'deterministic-demo-v1' NOT NULL,
	"triggered_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "worktruth_evidence_images" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"storage_key" text NOT NULL,
	"original_filename" text,
	"mime_type" text,
	"file_size_bytes" integer,
	"width" integer,
	"height" integer,
	"captured_at" timestamp with time zone,
	"gps_latitude" real,
	"gps_longitude" real,
	"gps_accuracy_meters" real,
	"perceptual_hash" text,
	"sha256" text,
	"label" text,
	"source" text DEFAULT 'manual' NOT NULL,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "worktruth_financial_records" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"type" text NOT NULL,
	"amount" integer NOT NULL,
	"recorded_date" date NOT NULL,
	"reference" text,
	"source" text DEFAULT 'manual' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "worktruth_import_batches" (
	"id" serial PRIMARY KEY NOT NULL,
	"source_filename" text NOT NULL,
	"accepted_count" integer DEFAULT 0 NOT NULL,
	"rejected_count" integer DEFAULT 0 NOT NULL,
	"quality_score" real DEFAULT 0 NOT NULL,
	"row_errors" jsonb,
	"imported_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "worktruth_investigation_notes" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"status" text NOT NULL,
	"note" text NOT NULL,
	"officer" text NOT NULL,
	"user_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "worktruth_investigations" (
	"project_id" text PRIMARY KEY NOT NULL,
	"status" text NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"decision" text DEFAULT '' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "worktruth_progress_records" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"report_date" date NOT NULL,
	"progress_percent" integer NOT NULL,
	"note" text,
	"source" text DEFAULT 'manual' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "worktruth_project_analyses" (
	"project_id" text PRIMARY KEY NOT NULL,
	"status" text NOT NULL,
	"payload" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "worktruth_projects" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"category" text NOT NULL,
	"district" text NOT NULL,
	"state" text NOT NULL,
	"location" text NOT NULL,
	"sanction_amount" integer NOT NULL,
	"expenditure" integer NOT NULL,
	"progress" integer NOT NULL,
	"evidence_quality" integer NOT NULL,
	"priority" text NOT NULL,
	"primary_flag" text NOT NULL,
	"latitude" real NOT NULL,
	"longitude" real NOT NULL,
	"start_date" date NOT NULL,
	"expected_completion" date NOT NULL,
	"actual_completion" date,
	"description" text NOT NULL,
	"contractor" text NOT NULL,
	"source" text DEFAULT 'manual' NOT NULL,
	"import_batch_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "worktruth_sessions" (
	"token" text PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "worktruth_users" (
	"id" serial PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"role" text NOT NULL,
	"password_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "worktruth_users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "worktruth_analysis_runs" ADD CONSTRAINT "worktruth_analysis_runs_project_id_worktruth_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."worktruth_projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worktruth_evidence_images" ADD CONSTRAINT "worktruth_evidence_images_project_id_worktruth_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."worktruth_projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worktruth_financial_records" ADD CONSTRAINT "worktruth_financial_records_project_id_worktruth_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."worktruth_projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worktruth_investigation_notes" ADD CONSTRAINT "worktruth_investigation_notes_project_id_worktruth_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."worktruth_projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worktruth_investigation_notes" ADD CONSTRAINT "worktruth_investigation_notes_user_id_worktruth_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."worktruth_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worktruth_investigations" ADD CONSTRAINT "worktruth_investigations_project_id_worktruth_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."worktruth_projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worktruth_progress_records" ADD CONSTRAINT "worktruth_progress_records_project_id_worktruth_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."worktruth_projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worktruth_project_analyses" ADD CONSTRAINT "worktruth_project_analyses_project_id_worktruth_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."worktruth_projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worktruth_projects" ADD CONSTRAINT "worktruth_projects_import_batch_id_worktruth_import_batches_id_fk" FOREIGN KEY ("import_batch_id") REFERENCES "public"."worktruth_import_batches"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worktruth_sessions" ADD CONSTRAINT "worktruth_sessions_user_id_worktruth_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."worktruth_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "worktruth_analysis_runs_project_created_idx" ON "worktruth_analysis_runs" USING btree ("project_id","created_at");--> statement-breakpoint
CREATE INDEX "worktruth_evidence_images_project_idx" ON "worktruth_evidence_images" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "worktruth_evidence_images_sha256_idx" ON "worktruth_evidence_images" USING btree ("project_id","sha256");--> statement-breakpoint
CREATE INDEX "worktruth_financial_records_project_date_idx" ON "worktruth_financial_records" USING btree ("project_id","recorded_date");--> statement-breakpoint
CREATE INDEX "worktruth_progress_records_project_date_idx" ON "worktruth_progress_records" USING btree ("project_id","report_date");--> statement-breakpoint
CREATE INDEX "worktruth_projects_category_district_idx" ON "worktruth_projects" USING btree ("category","district");--> statement-breakpoint
CREATE INDEX "worktruth_projects_import_batch_idx" ON "worktruth_projects" USING btree ("import_batch_id");--> statement-breakpoint
CREATE INDEX "worktruth_sessions_user_idx" ON "worktruth_sessions" USING btree ("user_id");