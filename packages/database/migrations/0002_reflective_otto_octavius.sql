CREATE TYPE "public"."agent_name" AS ENUM('intake-completeness-agent', 'credit-profile-agent', 'utilization-agent', 'payment-history-agent', 'debt-obligation-agent', 'readiness-stage-agent', 'roadmap-agent', 'education-agent', 'engagement-agent', 'report-agent', 'partner-routing-agent', 'compliance-guard-agent');--> statement-breakpoint
CREATE TYPE "public"."agent_status" AS ENUM('ok', 'needs_clarification', 'insufficient_data', 'blocked');--> statement-breakpoint
CREATE TYPE "public"."ai_review_status" AS ENUM('pending_review', 'approved', 'rejected', 'auto_published');--> statement-breakpoint
CREATE TYPE "public"."education_review_status" AS ENUM('not_required', 'pending_review', 'approved');--> statement-breakpoint
CREATE TYPE "public"."notification_channel" AS ENUM('in_app', 'email', 'sms');--> statement-breakpoint
CREATE TYPE "public"."notification_type" AS ENUM('appointment_scheduled', 'roadmap_published', 'report_published', 'document_requested', 'task_assigned');--> statement-breakpoint
CREATE TYPE "public"."partner_category" AS ENUM('credit_union', 'cpa_tax', 'housing_counselor', 'nonprofit_credit_counseling', 'small_business_lender', 'financial_coach');--> statement-breakpoint
CREATE TYPE "public"."partner_referral_status" AS ENUM('suggested', 'shared_with_client', 'client_engaged', 'outcome_recorded', 'declined');--> statement-breakpoint
CREATE TYPE "public"."referral_outcome" AS ENUM('engaged_supported_readiness', 'engaged_no_change', 'not_pursued');--> statement-breakpoint
CREATE TABLE "ai_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"agent_name" "agent_name" NOT NULL,
	"agent_version" text NOT NULL,
	"status" "agent_status" NOT NULL,
	"confidence" numeric(4, 3) NOT NULL,
	"facts_used" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"missing_facts" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"rule_versions_used" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"reason_codes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"proposed_actions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"prohibited_actions_detected" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"requires_human_review" boolean DEFAULT true NOT NULL,
	"review_status" "ai_review_status" DEFAULT 'pending_review' NOT NULL,
	"response_envelope" jsonb NOT NULL,
	"reviewed_by_member_id" uuid,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "communications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"notification_type" "notification_type" NOT NULL,
	"channel" "notification_channel" NOT NULL,
	"status" "communication_status" NOT NULL,
	"subject" text,
	"suppression_reason" text,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "education_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"lesson_id" text NOT NULL,
	"content_version" text NOT NULL,
	"trigger" text NOT NULL,
	"reason_code" text NOT NULL,
	"rule_version" text NOT NULL,
	"ai_run_id" uuid,
	"assigned_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"knowledge_check_score" numeric(4, 3),
	"staff_review_status" "education_review_status" DEFAULT 'not_required' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "handoff_packages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"schema_version" text NOT NULL,
	"recipient_scope" text NOT NULL,
	"consent_scope" text NOT NULL,
	"payload" jsonb NOT NULL,
	"payload_digest" varchar(64) NOT NULL,
	"signature" text NOT NULL,
	"key_id" text NOT NULL,
	"algorithm" text NOT NULL,
	"issued_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"rule_version" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification_preferences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"notification_type" "notification_type" NOT NULL,
	"channel" "notification_channel" NOT NULL,
	"enabled" boolean NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "partner_referrals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"partner_id" uuid NOT NULL,
	"status" "partner_referral_status" DEFAULT 'suggested' NOT NULL,
	"neutrality" jsonb NOT NULL,
	"outcome" "referral_outcome",
	"outcome_note" text,
	"created_by_member_id" uuid NOT NULL,
	"shared_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "partners" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"category" "partner_category" NOT NULL,
	"licensing_note" text DEFAULT '' NOT NULL,
	"non_commercial" boolean DEFAULT false NOT NULL,
	"compensation_disclosure" text DEFAULT '' NOT NULL,
	"eligibility_criteria" text DEFAULT '' NOT NULL,
	"estimated_user_cost" text DEFAULT '' NOT NULL,
	"key_risks" text DEFAULT '' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai_runs" ADD CONSTRAINT "ai_runs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_runs" ADD CONSTRAINT "ai_runs_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_runs" ADD CONSTRAINT "ai_runs_reviewed_by_member_id_organization_members_id_fk" FOREIGN KEY ("reviewed_by_member_id") REFERENCES "public"."organization_members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "communications" ADD CONSTRAINT "communications_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "communications" ADD CONSTRAINT "communications_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "education_assignments" ADD CONSTRAINT "education_assignments_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "education_assignments" ADD CONSTRAINT "education_assignments_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "education_assignments" ADD CONSTRAINT "education_assignments_ai_run_id_ai_runs_id_fk" FOREIGN KEY ("ai_run_id") REFERENCES "public"."ai_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "handoff_packages" ADD CONSTRAINT "handoff_packages_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "handoff_packages" ADD CONSTRAINT "handoff_packages_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_referrals" ADD CONSTRAINT "partner_referrals_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_referrals" ADD CONSTRAINT "partner_referrals_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_referrals" ADD CONSTRAINT "partner_referrals_partner_id_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partners"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_referrals" ADD CONSTRAINT "partner_referrals_created_by_member_id_organization_members_id_fk" FOREIGN KEY ("created_by_member_id") REFERENCES "public"."organization_members"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partners" ADD CONSTRAINT "partners_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_ai_runs_org_client" ON "ai_runs" USING btree ("organization_id","client_id","review_status");--> statement-breakpoint
CREATE INDEX "idx_comms_org_client_occurred" ON "communications" USING btree ("organization_id","client_id","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_education_client_lesson" ON "education_assignments" USING btree ("client_id","lesson_id");--> statement-breakpoint
CREATE INDEX "idx_handoff_org_client_digest" ON "handoff_packages" USING btree ("organization_id","client_id","payload_digest");--> statement-breakpoint
CREATE INDEX "idx_notif_pref_org_user" ON "notification_preferences" USING btree ("organization_id","user_id","notification_type","channel");--> statement-breakpoint
CREATE INDEX "idx_referrals_org_client" ON "partner_referrals" USING btree ("organization_id","client_id");--> statement-breakpoint
CREATE INDEX "idx_partners_org_active" ON "partners" USING btree ("organization_id","active");--> statement-breakpoint
ALTER TABLE "quarterly_reports" ADD CONSTRAINT "quarterly_reports_ai_run_id_ai_runs_id_fk" FOREIGN KEY ("ai_run_id") REFERENCES "public"."ai_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roadmaps" ADD CONSTRAINT "roadmaps_ai_run_id_ai_runs_id_fk" FOREIGN KEY ("ai_run_id") REFERENCES "public"."ai_runs"("id") ON DELETE set null ON UPDATE no action;