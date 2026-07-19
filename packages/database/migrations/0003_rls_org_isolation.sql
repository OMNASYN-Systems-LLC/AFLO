-- Row-Level Security: org isolation as defense-in-depth over the app-layer
-- tenancy checks. Every tenant-owned table (those with organization_id)
-- gets RLS ENABLED and FORCED (so even the table owner is subject to it),
-- with an org_isolation policy that fails CLOSED: when app.current_org_id is
-- unset, current_setting(..., true) returns NULL and no row matches; when it
-- is the empty string (a reset/cleared GUC), nullif() maps it to NULL rather
-- than erroring on ''::uuid, so it also matches no row instead of raising.
-- The application sets app.current_org_id to the server-verified org per
-- transaction; the browser never supplies it. organizations, users, and
-- rule_versions are tenant roots / global and are intentionally NOT covered.

ALTER TABLE "organization_members" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "organization_members" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "org_isolation" ON "organization_members" AS PERMISSIVE FOR ALL USING ("organization_id" = nullif(current_setting('app.current_org_id', true), '')::uuid) WITH CHECK ("organization_id" = nullif(current_setting('app.current_org_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "consent_records" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "consent_records" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "org_isolation" ON "consent_records" AS PERMISSIVE FOR ALL USING ("organization_id" = nullif(current_setting('app.current_org_id', true), '')::uuid) WITH CHECK ("organization_id" = nullif(current_setting('app.current_org_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "audit_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "audit_events" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "org_isolation" ON "audit_events" AS PERMISSIVE FOR ALL USING ("organization_id" = nullif(current_setting('app.current_org_id', true), '')::uuid) WITH CHECK ("organization_id" = nullif(current_setting('app.current_org_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "outbox" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "outbox" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "org_isolation" ON "outbox" AS PERMISSIVE FOR ALL USING ("organization_id" = nullif(current_setting('app.current_org_id', true), '')::uuid) WITH CHECK ("organization_id" = nullif(current_setting('app.current_org_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "clients" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "clients" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "org_isolation" ON "clients" AS PERMISSIVE FOR ALL USING ("organization_id" = nullif(current_setting('app.current_org_id', true), '')::uuid) WITH CHECK ("organization_id" = nullif(current_setting('app.current_org_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "intakes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "intakes" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "org_isolation" ON "intakes" AS PERMISSIVE FOR ALL USING ("organization_id" = nullif(current_setting('app.current_org_id', true), '')::uuid) WITH CHECK ("organization_id" = nullif(current_setting('app.current_org_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "readiness_assessments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "readiness_assessments" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "org_isolation" ON "readiness_assessments" AS PERMISSIVE FOR ALL USING ("organization_id" = nullif(current_setting('app.current_org_id', true), '')::uuid) WITH CHECK ("organization_id" = nullif(current_setting('app.current_org_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "financial_profiles" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "financial_profiles" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "org_isolation" ON "financial_profiles" AS PERMISSIVE FOR ALL USING ("organization_id" = nullif(current_setting('app.current_org_id', true), '')::uuid) WITH CHECK ("organization_id" = nullif(current_setting('app.current_org_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "credit_profiles" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "credit_profiles" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "org_isolation" ON "credit_profiles" AS PERMISSIVE FOR ALL USING ("organization_id" = nullif(current_setting('app.current_org_id', true), '')::uuid) WITH CHECK ("organization_id" = nullif(current_setting('app.current_org_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "goals" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "goals" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "org_isolation" ON "goals" AS PERMISSIVE FOR ALL USING ("organization_id" = nullif(current_setting('app.current_org_id', true), '')::uuid) WITH CHECK ("organization_id" = nullif(current_setting('app.current_org_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "roadmaps" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "roadmaps" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "org_isolation" ON "roadmaps" AS PERMISSIVE FOR ALL USING ("organization_id" = nullif(current_setting('app.current_org_id', true), '')::uuid) WITH CHECK ("organization_id" = nullif(current_setting('app.current_org_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "roadmap_milestones" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "roadmap_milestones" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "org_isolation" ON "roadmap_milestones" AS PERMISSIVE FOR ALL USING ("organization_id" = nullif(current_setting('app.current_org_id', true), '')::uuid) WITH CHECK ("organization_id" = nullif(current_setting('app.current_org_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "monthly_actions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "monthly_actions" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "org_isolation" ON "monthly_actions" AS PERMISSIVE FOR ALL USING ("organization_id" = nullif(current_setting('app.current_org_id', true), '')::uuid) WITH CHECK ("organization_id" = nullif(current_setting('app.current_org_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "documents" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "documents" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "org_isolation" ON "documents" AS PERMISSIVE FOR ALL USING ("organization_id" = nullif(current_setting('app.current_org_id', true), '')::uuid) WITH CHECK ("organization_id" = nullif(current_setting('app.current_org_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "appointments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "appointments" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "org_isolation" ON "appointments" AS PERMISSIVE FOR ALL USING ("organization_id" = nullif(current_setting('app.current_org_id', true), '')::uuid) WITH CHECK ("organization_id" = nullif(current_setting('app.current_org_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "quarterly_reports" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "quarterly_reports" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "org_isolation" ON "quarterly_reports" AS PERMISSIVE FOR ALL USING ("organization_id" = nullif(current_setting('app.current_org_id', true), '')::uuid) WITH CHECK ("organization_id" = nullif(current_setting('app.current_org_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "notes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "notes" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "org_isolation" ON "notes" AS PERMISSIVE FOR ALL USING ("organization_id" = nullif(current_setting('app.current_org_id', true), '')::uuid) WITH CHECK ("organization_id" = nullif(current_setting('app.current_org_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "simulation_settings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "simulation_settings" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "org_isolation" ON "simulation_settings" AS PERMISSIVE FOR ALL USING ("organization_id" = nullif(current_setting('app.current_org_id', true), '')::uuid) WITH CHECK ("organization_id" = nullif(current_setting('app.current_org_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "virtual_transactions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "virtual_transactions" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "org_isolation" ON "virtual_transactions" AS PERMISSIVE FOR ALL USING ("organization_id" = nullif(current_setting('app.current_org_id', true), '')::uuid) WITH CHECK ("organization_id" = nullif(current_setting('app.current_org_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "ai_runs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "ai_runs" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "org_isolation" ON "ai_runs" AS PERMISSIVE FOR ALL USING ("organization_id" = nullif(current_setting('app.current_org_id', true), '')::uuid) WITH CHECK ("organization_id" = nullif(current_setting('app.current_org_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "partners" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "partners" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "org_isolation" ON "partners" AS PERMISSIVE FOR ALL USING ("organization_id" = nullif(current_setting('app.current_org_id', true), '')::uuid) WITH CHECK ("organization_id" = nullif(current_setting('app.current_org_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "partner_referrals" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "partner_referrals" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "org_isolation" ON "partner_referrals" AS PERMISSIVE FOR ALL USING ("organization_id" = nullif(current_setting('app.current_org_id', true), '')::uuid) WITH CHECK ("organization_id" = nullif(current_setting('app.current_org_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "education_assignments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "education_assignments" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "org_isolation" ON "education_assignments" AS PERMISSIVE FOR ALL USING ("organization_id" = nullif(current_setting('app.current_org_id', true), '')::uuid) WITH CHECK ("organization_id" = nullif(current_setting('app.current_org_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "notification_preferences" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "notification_preferences" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "org_isolation" ON "notification_preferences" AS PERMISSIVE FOR ALL USING ("organization_id" = nullif(current_setting('app.current_org_id', true), '')::uuid) WITH CHECK ("organization_id" = nullif(current_setting('app.current_org_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "communications" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "communications" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "org_isolation" ON "communications" AS PERMISSIVE FOR ALL USING ("organization_id" = nullif(current_setting('app.current_org_id', true), '')::uuid) WITH CHECK ("organization_id" = nullif(current_setting('app.current_org_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "handoff_packages" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "handoff_packages" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "org_isolation" ON "handoff_packages" AS PERMISSIVE FOR ALL USING ("organization_id" = nullif(current_setting('app.current_org_id', true), '')::uuid) WITH CHECK ("organization_id" = nullif(current_setting('app.current_org_id', true), '')::uuid);--> statement-breakpoint
