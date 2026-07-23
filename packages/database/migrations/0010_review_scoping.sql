-- Migration 0010 — org-scoped open-review uniqueness + artifact version/digest
-- (Workstream A PR-5, founder decision 2026-07-23 #3, verbatim: "Open-review
-- uniqueness must be organization-scoped. There may be only one active open
-- review for: organization_id, artifact_type, artifact_id, artifact_version,
-- workflow_type. Terminal reviews do not prevent a new review. A new artifact
-- version requires a new review.")
--
-- Forward-only and NON-DESTRUCTIVE: three additive columns + an index
-- replacement implementing the founder's tuple verbatim; no data is dropped.
-- The temporary DEFAULTs exist only so the DDL is valid on a non-empty table;
-- review_items was born in migration 0009 and no write path existed before
-- this PR, so the table is empty in every environment — each DEFAULT is
-- dropped immediately (ADR-0043).
ALTER TABLE "review_items" ADD COLUMN "artifact_version" text NOT NULL DEFAULT '1';--> statement-breakpoint
ALTER TABLE "review_items" ALTER COLUMN "artifact_version" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "review_items" ADD COLUMN "artifact_digest" varchar(64) NOT NULL DEFAULT '';--> statement-breakpoint
ALTER TABLE "review_items" ALTER COLUMN "artifact_digest" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "review_items" ADD COLUMN "workflow_type" "review_artifact_type" NOT NULL DEFAULT 'readiness_assessment';--> statement-breakpoint
ALTER TABLE "review_items" ALTER COLUMN "workflow_type" DROP DEFAULT;--> statement-breakpoint
DROP INDEX "uq_review_items_open";--> statement-breakpoint
CREATE UNIQUE INDEX "uq_review_items_open" ON "review_items" USING btree ("organization_id","artifact_type","artifact_id","artifact_version","workflow_type") WHERE state IN ('draft','awaiting_review');
