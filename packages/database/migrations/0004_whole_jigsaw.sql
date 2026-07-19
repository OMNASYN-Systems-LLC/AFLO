ALTER TABLE "outbox" ADD COLUMN "max_attempts" integer DEFAULT 5 NOT NULL;--> statement-breakpoint
ALTER TABLE "outbox" ADD COLUMN "processed_at" timestamp with time zone;