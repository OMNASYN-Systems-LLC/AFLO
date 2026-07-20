CREATE TYPE "public"."client_user_link_status" AS ENUM('active', 'revoked');--> statement-breakpoint
CREATE TYPE "public"."identity_provider" AS ENUM('clerk');--> statement-breakpoint
CREATE TYPE "public"."invitation_status" AS ENUM('pending', 'accepted', 'revoked', 'expired');--> statement-breakpoint
CREATE TYPE "public"."invitation_type" AS ENUM('staff', 'client');--> statement-breakpoint
CREATE TYPE "public"."invited_role" AS ENUM('organization_owner', 'organization_admin', 'staff_advisor', 'client');--> statement-breakpoint
CREATE TYPE "public"."webhook_event_status" AS ENUM('received', 'processed', 'failed');--> statement-breakpoint
CREATE TABLE "client_user_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"status" "client_user_link_status" DEFAULT 'active' NOT NULL,
	"linked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "identity_provider_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" "identity_provider" NOT NULL,
	"provider_user_id" text NOT NULL,
	"aflo_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invitations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"email" text NOT NULL,
	"invitation_type" "invitation_type" NOT NULL,
	"intended_role" "invited_role" NOT NULL,
	"intended_client_id" uuid,
	"token_digest" varchar(64) NOT NULL,
	"status" "invitation_status" DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_by_member_id" uuid,
	"accepted_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "provider_webhook_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" "identity_provider" NOT NULL,
	"provider_event_id" text NOT NULL,
	"event_type" text NOT NULL,
	"payload_digest" varchar(64) NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	"status" "webhook_event_status" DEFAULT 'received' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session_revocations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"organization_id" uuid,
	"provider_session_id_digest" varchar(64),
	"reason_code" text NOT NULL,
	"revoked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "client_user_links" ADD CONSTRAINT "client_user_links_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_user_links" ADD CONSTRAINT "client_user_links_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_user_links" ADD CONSTRAINT "client_user_links_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity_provider_accounts" ADD CONSTRAINT "identity_provider_accounts_aflo_user_id_users_id_fk" FOREIGN KEY ("aflo_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_intended_client_id_clients_id_fk" FOREIGN KEY ("intended_client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_created_by_member_id_organization_members_id_fk" FOREIGN KEY ("created_by_member_id") REFERENCES "public"."organization_members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_accepted_by_user_id_users_id_fk" FOREIGN KEY ("accepted_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_revocations" ADD CONSTRAINT "session_revocations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_revocations" ADD CONSTRAINT "session_revocations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_revocations" ADD CONSTRAINT "session_revocations_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_client_links_active_client" ON "client_user_links" USING btree ("organization_id","client_id") WHERE status = 'active';--> statement-breakpoint
CREATE UNIQUE INDEX "uq_client_links_active_user" ON "client_user_links" USING btree ("organization_id","user_id") WHERE status = 'active';--> statement-breakpoint
CREATE UNIQUE INDEX "uq_idp_provider_user" ON "identity_provider_accounts" USING btree ("provider","provider_user_id");--> statement-breakpoint
CREATE INDEX "idx_idp_aflo_user" ON "identity_provider_accounts" USING btree ("aflo_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_invitations_org_token" ON "invitations" USING btree ("organization_id","token_digest");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_invitations_pending_email" ON "invitations" USING btree ("organization_id","email") WHERE status = 'pending';--> statement-breakpoint
CREATE INDEX "idx_invitations_org_status" ON "invitations" USING btree ("organization_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_webhook_provider_event" ON "provider_webhook_events" USING btree ("provider","provider_event_id");--> statement-breakpoint
CREATE INDEX "idx_session_revocations_user" ON "session_revocations" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_session_revocations_user_revoked" ON "session_revocations" USING btree ("user_id","revoked_at");--> statement-breakpoint
-- Row-Level Security for the org-owned auth tables (same fail-closed org_isolation
-- pattern as migration 0003). identity_provider_accounts, provider_webhook_events,
-- and session_revocations are intentionally NOT org-scoped — they are read by the
-- auth resolver BEFORE an org context exists (identity mapping, a user's
-- revocations) or across orgs (provider webhook receipts), via the privileged
-- auth-resolver/service path, exactly like organizations/users/rule_versions.
ALTER TABLE "invitations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "invitations" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "org_isolation" ON "invitations" AS PERMISSIVE FOR ALL USING ("organization_id" = nullif(current_setting('app.current_org_id', true), '')::uuid) WITH CHECK ("organization_id" = nullif(current_setting('app.current_org_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "client_user_links" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "client_user_links" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "org_isolation" ON "client_user_links" AS PERMISSIVE FOR ALL USING ("organization_id" = nullif(current_setting('app.current_org_id', true), '')::uuid) WITH CHECK ("organization_id" = nullif(current_setting('app.current_org_id', true), '')::uuid);