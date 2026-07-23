-- Migration 0011 — durable playbook governance (Workstream A, ADR-0047).
-- Closes the ADR-0043 known gap: founder decision 2026-07-23 #2 (author/
-- approver separation + the documented single-operator owner override) was
-- STORE-LEVEL ONLY; this migration gives the durable layer the columns that
-- enforcement needs. Forward-only and ADDITIVE — no data is touched, no
-- index changes, no drops.
--
--  * playbook_versions.published_by_member_id — publisher identity, stamped
--    by the repository from the ACTING member on publish (never optional,
--    never anonymous). ON DELETE SET NULL mirrors approver_member_id.
--  * playbook_versions.review_history — append-only jsonb log of executed
--    transitions ({action, actorMemberId, reasonCode, ownerOverride,
--    occurredAt} — ids/codes only, never content). The founder's owner
--    override is VISIBLE here, per the directive.
--  * organizations.allow_single_operator_playbook_override — the org policy
--    flag gating the documented owner override. Default FALSE (matches the
--    @aflo/shared Organization default, including the Golden Key seed).
ALTER TABLE "playbook_versions" ADD COLUMN "published_by_member_id" uuid;--> statement-breakpoint
ALTER TABLE "playbook_versions" ADD CONSTRAINT "playbook_versions_published_by_member_id_organization_members_id_fk" FOREIGN KEY ("published_by_member_id") REFERENCES "public"."organization_members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "playbook_versions" ADD COLUMN "review_history" jsonb NOT NULL DEFAULT '[]'::jsonb;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "allow_single_operator_playbook_override" boolean NOT NULL DEFAULT false;
