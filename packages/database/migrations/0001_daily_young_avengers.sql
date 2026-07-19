CREATE TYPE "public"."appointment_channel" AS ENUM('video', 'phone', 'in_person');--> statement-breakpoint
CREATE TYPE "public"."credit_score_source" AS ENUM('manual_entry', 'uploaded_report');--> statement-breakpoint
CREATE TYPE "public"."document_type" AS ENUM('credit_report', 'income_verification', 'bank_statement', 'identification', 'other');--> statement-breakpoint
CREATE TYPE "public"."goal_category" AS ENUM('credit', 'savings', 'debt', 'home_purchase', 'business_capital', 'other');--> statement-breakpoint
CREATE TYPE "public"."income_stability" AS ENUM('stable', 'variable', 'unstable');--> statement-breakpoint
CREATE TYPE "public"."milestone_status" AS ENUM('upcoming', 'in_progress', 'completed');--> statement-breakpoint
CREATE TYPE "public"."monthly_action_category" AS ENUM('payment', 'savings', 'documentation', 'education', 'habit');--> statement-breakpoint
CREATE TABLE "appointments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"member_id" uuid,
	"purpose" text NOT NULL,
	"scheduled_at" timestamp with time zone NOT NULL,
	"channel" "appointment_channel" NOT NULL,
	"reminder_sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "credit_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"score" integer,
	"score_source" "credit_score_source" NOT NULL,
	"score_as_of" date,
	"revolving_balance_cents" bigint NOT NULL,
	"revolving_limit_cents" bigint NOT NULL,
	"open_tradelines" integer NOT NULL,
	"derogatory_marks" integer NOT NULL,
	"on_time_payment_rate" numeric(4, 3) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"name" text NOT NULL,
	"doc_type" "document_type" NOT NULL,
	"review_status" "document_review_status" DEFAULT 'requested' NOT NULL,
	"storage_path_encrypted" "bytea",
	"checksum_sha256" varchar(64),
	"reviewed_by_member_id" uuid,
	"reviewed_at" timestamp with time zone,
	"uploaded_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "financial_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"monthly_income_cents" bigint NOT NULL,
	"monthly_debt_payments_cents" bigint NOT NULL,
	"liquid_savings_cents" bigint NOT NULL,
	"monthly_essential_expenses_cents" bigint NOT NULL,
	"income_stability" "income_stability" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "goals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"title" text NOT NULL,
	"category" "goal_category" NOT NULL,
	"target_date" date NOT NULL,
	"progress_pct" integer DEFAULT 0 NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "monthly_actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"month" text NOT NULL,
	"title" text NOT NULL,
	"category" "monthly_action_category" NOT NULL,
	"status" "action_status" DEFAULT 'todo' NOT NULL,
	"due_date" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"author_member_id" uuid NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quarterly_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"quarter" text NOT NULL,
	"status" "report_status" DEFAULT 'draft' NOT NULL,
	"stage_at_generation" "lifecycle_stage" NOT NULL,
	"highlights" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"focus_for_next_quarter" text DEFAULT '' NOT NULL,
	"ai_run_id" uuid,
	"approved_by_member_id" uuid,
	"approved_at" timestamp with time zone,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "readiness_assessments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"stage" "lifecycle_stage" NOT NULL,
	"previous_stage" "lifecycle_stage",
	"rule_version" text NOT NULL,
	"facts_used" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"reason_codes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"proposed_next_action" text DEFAULT '' NOT NULL,
	"requires_human_review" boolean DEFAULT false NOT NULL,
	"review_reason_codes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"assessed_by_member_id" uuid,
	"assessed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "roadmap_milestones" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"roadmap_id" uuid NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"status" "milestone_status" DEFAULT 'upcoming' NOT NULL,
	"target_month" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "roadmaps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"title" text NOT NULL,
	"status" "roadmap_status" DEFAULT 'draft' NOT NULL,
	"stage_at_creation" "lifecycle_stage" NOT NULL,
	"ai_run_id" uuid,
	"created_by_member_id" uuid NOT NULL,
	"approved_by_member_id" uuid,
	"approved_at" timestamp with time zone,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "simulation_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"round_to_cents" integer DEFAULT 100 NOT NULL,
	"multiplier" numeric(4, 2) DEFAULT '1.00' NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "virtual_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"label" text NOT NULL,
	"amount_cents" bigint NOT NULL,
	"round_up_amount_cents" bigint NOT NULL,
	"occurred_on" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_member_id_organization_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."organization_members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_profiles" ADD CONSTRAINT "credit_profiles_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_profiles" ADD CONSTRAINT "credit_profiles_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_reviewed_by_member_id_organization_members_id_fk" FOREIGN KEY ("reviewed_by_member_id") REFERENCES "public"."organization_members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_uploaded_by_user_id_users_id_fk" FOREIGN KEY ("uploaded_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_profiles" ADD CONSTRAINT "financial_profiles_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_profiles" ADD CONSTRAINT "financial_profiles_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goals" ADD CONSTRAINT "goals_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goals" ADD CONSTRAINT "goals_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "monthly_actions" ADD CONSTRAINT "monthly_actions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "monthly_actions" ADD CONSTRAINT "monthly_actions_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notes" ADD CONSTRAINT "notes_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notes" ADD CONSTRAINT "notes_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notes" ADD CONSTRAINT "notes_author_member_id_organization_members_id_fk" FOREIGN KEY ("author_member_id") REFERENCES "public"."organization_members"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quarterly_reports" ADD CONSTRAINT "quarterly_reports_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quarterly_reports" ADD CONSTRAINT "quarterly_reports_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quarterly_reports" ADD CONSTRAINT "quarterly_reports_approved_by_member_id_organization_members_id_fk" FOREIGN KEY ("approved_by_member_id") REFERENCES "public"."organization_members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "readiness_assessments" ADD CONSTRAINT "readiness_assessments_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "readiness_assessments" ADD CONSTRAINT "readiness_assessments_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "readiness_assessments" ADD CONSTRAINT "readiness_assessments_assessed_by_member_id_organization_members_id_fk" FOREIGN KEY ("assessed_by_member_id") REFERENCES "public"."organization_members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roadmap_milestones" ADD CONSTRAINT "roadmap_milestones_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roadmap_milestones" ADD CONSTRAINT "roadmap_milestones_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roadmap_milestones" ADD CONSTRAINT "roadmap_milestones_roadmap_id_roadmaps_id_fk" FOREIGN KEY ("roadmap_id") REFERENCES "public"."roadmaps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roadmaps" ADD CONSTRAINT "roadmaps_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roadmaps" ADD CONSTRAINT "roadmaps_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roadmaps" ADD CONSTRAINT "roadmaps_created_by_member_id_organization_members_id_fk" FOREIGN KEY ("created_by_member_id") REFERENCES "public"."organization_members"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roadmaps" ADD CONSTRAINT "roadmaps_approved_by_member_id_organization_members_id_fk" FOREIGN KEY ("approved_by_member_id") REFERENCES "public"."organization_members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "simulation_settings" ADD CONSTRAINT "simulation_settings_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "simulation_settings" ADD CONSTRAINT "simulation_settings_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "virtual_transactions" ADD CONSTRAINT "virtual_transactions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "virtual_transactions" ADD CONSTRAINT "virtual_transactions_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_appointments_org_scheduled" ON "appointments" USING btree ("organization_id","scheduled_at");--> statement-breakpoint
CREATE INDEX "idx_appointments_org_client" ON "appointments" USING btree ("organization_id","client_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_credit_profiles_client" ON "credit_profiles" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "idx_documents_org_client_status" ON "documents" USING btree ("organization_id","client_id","review_status");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_financial_profiles_client" ON "financial_profiles" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "idx_goals_org_client" ON "goals" USING btree ("organization_id","client_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_goals_client_primary" ON "goals" USING btree ("client_id") WHERE "goals"."is_primary";--> statement-breakpoint
CREATE INDEX "idx_monthly_actions_org_client_month" ON "monthly_actions" USING btree ("organization_id","client_id","month");--> statement-breakpoint
CREATE INDEX "idx_notes_org_client_created" ON "notes" USING btree ("organization_id","client_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_reports_client_quarter" ON "quarterly_reports" USING btree ("client_id","quarter");--> statement-breakpoint
CREATE INDEX "idx_readiness_org_client_assessed" ON "readiness_assessments" USING btree ("organization_id","client_id","assessed_at");--> statement-breakpoint
CREATE INDEX "idx_milestones_org_roadmap_order" ON "roadmap_milestones" USING btree ("organization_id","roadmap_id","sort_order");--> statement-breakpoint
CREATE INDEX "idx_roadmaps_org_client_status" ON "roadmaps" USING btree ("organization_id","client_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_simulation_settings_client" ON "simulation_settings" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "idx_vtx_org_client_occurred" ON "virtual_transactions" USING btree ("organization_id","client_id","occurred_on");