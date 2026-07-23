CREATE TYPE "public"."review_artifact_type" AS ENUM('readiness_assessment', 'roadmap_draft', 'concierge_recommendation', 'document_interpretation', 'financial_summary', 'educational_assignment', 'partner_referral', 'client_communication', 'quarterly_report', 'stage_advancement');--> statement-breakpoint
CREATE TYPE "public"."review_decision" AS ENUM('approved_unchanged', 'approved_with_edits', 'rejected', 'escalated', 'deferred');--> statement-breakpoint
CREATE TYPE "public"."review_item_state" AS ENUM('draft', 'awaiting_review', 'approved', 'published', 'rejected', 'deferred', 'withdrawn', 'superseded');--> statement-breakpoint
CREATE TYPE "public"."review_risk_class" AS ENUM('low', 'medium', 'high');--> statement-breakpoint
CREATE TYPE "public"."reviewer_role" AS ENUM('staff', 'organization_admin', 'organization_owner');--> statement-breakpoint
CREATE TYPE "public"."workflow_discovery_status" AS ENUM('open', 'answered', 'converted', 'dismissed');--> statement-breakpoint
CREATE TABLE "playbook_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"playbook_id" uuid NOT NULL,
	"version" text NOT NULL,
	"status" "review_item_state" DEFAULT 'draft' NOT NULL,
	"effective_date" timestamp with time zone,
	"author_member_id" uuid NOT NULL,
	"approver_member_id" uuid,
	"approved_at" timestamp with time zone,
	"content" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "playbooks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"playbook_key" text NOT NULL,
	"name" text NOT NULL,
	"current_version_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "review_decisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"review_item_id" uuid NOT NULL,
	"decision" "review_decision" NOT NULL,
	"reason_code" text NOT NULL,
	"rule_version" text NOT NULL,
	"decided_by_member_id" uuid NOT NULL,
	"client_stage_at_decision" "lifecycle_stage",
	"workflow_type" "review_artifact_type" NOT NULL,
	"ai_run_id" uuid,
	"agent_version" text,
	"edited_fields" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"final_output_sha256" varchar(64),
	"escalated_to_role" "reviewer_role",
	"detail" text,
	"decided_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "review_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"client_id" uuid,
	"artifact_type" "review_artifact_type" NOT NULL,
	"artifact_id" text NOT NULL,
	"source_fact_snapshots" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"rule_versions_used" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"ai_run_id" uuid,
	"ai_model" text,
	"ai_prompt_version" text,
	"confidence" numeric(4, 3),
	"risk_classification" "review_risk_class" NOT NULL,
	"required_reviewer_role" "reviewer_role" NOT NULL,
	"state" "review_item_state" DEFAULT 'draft' NOT NULL,
	"assigned_reviewer_member_id" uuid,
	"reviewed_by_member_id" uuid,
	"reviewed_at" timestamp with time zone,
	"latest_decision" "review_decision",
	"latest_decision_reason_code" text,
	"modifications_digest" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"published_result_ref" text,
	"published_at" timestamp with time zone,
	"playbook_id" uuid,
	"playbook_version" text,
	"previous_review_item_id" uuid,
	"superseded_by_review_item_id" uuid,
	"client_action_ref" text,
	"client_action_status" text,
	"outcome" text,
	"outcome_recorded_at" timestamp with time zone,
	"created_by_member_id" uuid,
	"submitted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workflow_discovery_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"playbook_id" uuid,
	"checkpoint_ref" text,
	"question" text NOT NULL,
	"context" text DEFAULT '' NOT NULL,
	"status" "workflow_discovery_status" DEFAULT 'open' NOT NULL,
	"raised_by_member_id" uuid,
	"answer" text,
	"answered_by_member_id" uuid,
	"answered_at" timestamp with time zone,
	"converted_playbook_version_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "playbook_versions" ADD CONSTRAINT "playbook_versions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "playbook_versions" ADD CONSTRAINT "playbook_versions_playbook_id_playbooks_id_fk" FOREIGN KEY ("playbook_id") REFERENCES "public"."playbooks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "playbook_versions" ADD CONSTRAINT "playbook_versions_author_member_id_organization_members_id_fk" FOREIGN KEY ("author_member_id") REFERENCES "public"."organization_members"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "playbook_versions" ADD CONSTRAINT "playbook_versions_approver_member_id_organization_members_id_fk" FOREIGN KEY ("approver_member_id") REFERENCES "public"."organization_members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "playbooks" ADD CONSTRAINT "playbooks_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "playbooks" ADD CONSTRAINT "playbooks_current_version_id_playbook_versions_id_fk" FOREIGN KEY ("current_version_id") REFERENCES "public"."playbook_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_decisions" ADD CONSTRAINT "review_decisions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_decisions" ADD CONSTRAINT "review_decisions_review_item_id_review_items_id_fk" FOREIGN KEY ("review_item_id") REFERENCES "public"."review_items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_decisions" ADD CONSTRAINT "review_decisions_decided_by_member_id_organization_members_id_fk" FOREIGN KEY ("decided_by_member_id") REFERENCES "public"."organization_members"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_decisions" ADD CONSTRAINT "review_decisions_ai_run_id_ai_runs_id_fk" FOREIGN KEY ("ai_run_id") REFERENCES "public"."ai_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_items" ADD CONSTRAINT "review_items_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_items" ADD CONSTRAINT "review_items_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_items" ADD CONSTRAINT "review_items_ai_run_id_ai_runs_id_fk" FOREIGN KEY ("ai_run_id") REFERENCES "public"."ai_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_items" ADD CONSTRAINT "review_items_assigned_reviewer_member_id_organization_members_id_fk" FOREIGN KEY ("assigned_reviewer_member_id") REFERENCES "public"."organization_members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_items" ADD CONSTRAINT "review_items_reviewed_by_member_id_organization_members_id_fk" FOREIGN KEY ("reviewed_by_member_id") REFERENCES "public"."organization_members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_items" ADD CONSTRAINT "review_items_playbook_id_playbooks_id_fk" FOREIGN KEY ("playbook_id") REFERENCES "public"."playbooks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_items" ADD CONSTRAINT "review_items_previous_review_item_id_review_items_id_fk" FOREIGN KEY ("previous_review_item_id") REFERENCES "public"."review_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_items" ADD CONSTRAINT "review_items_superseded_by_review_item_id_review_items_id_fk" FOREIGN KEY ("superseded_by_review_item_id") REFERENCES "public"."review_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_items" ADD CONSTRAINT "review_items_created_by_member_id_organization_members_id_fk" FOREIGN KEY ("created_by_member_id") REFERENCES "public"."organization_members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_discovery_items" ADD CONSTRAINT "workflow_discovery_items_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_discovery_items" ADD CONSTRAINT "workflow_discovery_items_playbook_id_playbooks_id_fk" FOREIGN KEY ("playbook_id") REFERENCES "public"."playbooks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_discovery_items" ADD CONSTRAINT "workflow_discovery_items_raised_by_member_id_organization_members_id_fk" FOREIGN KEY ("raised_by_member_id") REFERENCES "public"."organization_members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_discovery_items" ADD CONSTRAINT "workflow_discovery_items_answered_by_member_id_organization_members_id_fk" FOREIGN KEY ("answered_by_member_id") REFERENCES "public"."organization_members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_discovery_items" ADD CONSTRAINT "workflow_discovery_items_converted_playbook_version_id_playbook_versions_id_fk" FOREIGN KEY ("converted_playbook_version_id") REFERENCES "public"."playbook_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_playbook_versions_playbook_version" ON "playbook_versions" USING btree ("playbook_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_playbooks_org_key" ON "playbooks" USING btree ("organization_id","playbook_key");--> statement-breakpoint
CREATE INDEX "idx_review_decisions_org_item" ON "review_decisions" USING btree ("organization_id","review_item_id","decided_at");--> statement-breakpoint
CREATE INDEX "idx_review_items_org_type_state" ON "review_items" USING btree ("organization_id","artifact_type","state");--> statement-breakpoint
CREATE INDEX "idx_review_items_org_client" ON "review_items" USING btree ("organization_id","client_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_review_items_open" ON "review_items" USING btree ("artifact_type","artifact_id") WHERE state IN ('draft', 'awaiting_review');--> statement-breakpoint
CREATE INDEX "idx_discovery_org_status" ON "workflow_discovery_items" USING btree ("organization_id","status");--> statement-breakpoint
-- Row-Level Security for the Review Center / Playbook / Discovery tables (same
-- fail-closed org_isolation pattern as migration 0003). All five are
-- tenant-owned: a row is visible only when app.current_org_id matches its
-- organization_id (an unset or empty GUC → NULL → matches nothing). Playbook
-- content is versioned TENANT IP and review decisions are tenant governance
-- records — none of it is ever readable across organizations.
ALTER TABLE "review_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "review_items" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "org_isolation" ON "review_items" AS PERMISSIVE FOR ALL USING ("organization_id" = nullif(current_setting('app.current_org_id', true), '')::uuid) WITH CHECK ("organization_id" = nullif(current_setting('app.current_org_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "review_decisions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "review_decisions" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "org_isolation" ON "review_decisions" AS PERMISSIVE FOR ALL USING ("organization_id" = nullif(current_setting('app.current_org_id', true), '')::uuid) WITH CHECK ("organization_id" = nullif(current_setting('app.current_org_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "playbooks" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "playbooks" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "org_isolation" ON "playbooks" AS PERMISSIVE FOR ALL USING ("organization_id" = nullif(current_setting('app.current_org_id', true), '')::uuid) WITH CHECK ("organization_id" = nullif(current_setting('app.current_org_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "playbook_versions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "playbook_versions" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "org_isolation" ON "playbook_versions" AS PERMISSIVE FOR ALL USING ("organization_id" = nullif(current_setting('app.current_org_id', true), '')::uuid) WITH CHECK ("organization_id" = nullif(current_setting('app.current_org_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "workflow_discovery_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "workflow_discovery_items" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "org_isolation" ON "workflow_discovery_items" AS PERMISSIVE FOR ALL USING ("organization_id" = nullif(current_setting('app.current_org_id', true), '')::uuid) WITH CHECK ("organization_id" = nullif(current_setting('app.current_org_id', true), '')::uuid);