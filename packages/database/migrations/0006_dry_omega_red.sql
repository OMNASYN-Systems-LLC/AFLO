CREATE TYPE "public"."message_sender_role" AS ENUM('staff', 'client');--> statement-breakpoint
CREATE TYPE "public"."thread_status" AS ENUM('open', 'closed');--> statement-breakpoint
CREATE TABLE "conversation_threads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"subject" text NOT NULL,
	"status" "thread_status" DEFAULT 'open' NOT NULL,
	"last_message_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"thread_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"sender_role" "message_sender_role" NOT NULL,
	"sender_id" uuid NOT NULL,
	"body_encrypted" "bytea" NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	"read_by_client_at" timestamp with time zone,
	"read_by_staff_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "conversation_threads" ADD CONSTRAINT "conversation_threads_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_threads" ADD CONSTRAINT "conversation_threads_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_thread_id_conversation_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."conversation_threads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_threads_org_client" ON "conversation_threads" USING btree ("organization_id","client_id");--> statement-breakpoint
CREATE INDEX "idx_threads_org_status" ON "conversation_threads" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "idx_messages_org_thread_sent" ON "messages" USING btree ("organization_id","thread_id","sent_at");--> statement-breakpoint
CREATE INDEX "idx_messages_org_client" ON "messages" USING btree ("organization_id","client_id");--> statement-breakpoint
-- Row-Level Security for the secure-messaging tables (same fail-closed
-- org_isolation pattern as migration 0003). Both threads and messages are
-- tenant-owned; a row is visible only when app.current_org_id matches its
-- organization_id (an unset or empty GUC → NULL → matches nothing).
ALTER TABLE "conversation_threads" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "conversation_threads" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "org_isolation" ON "conversation_threads" AS PERMISSIVE FOR ALL USING ("organization_id" = nullif(current_setting('app.current_org_id', true), '')::uuid) WITH CHECK ("organization_id" = nullif(current_setting('app.current_org_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "messages" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "messages" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "org_isolation" ON "messages" AS PERMISSIVE FOR ALL USING ("organization_id" = nullif(current_setting('app.current_org_id', true), '')::uuid) WITH CHECK ("organization_id" = nullif(current_setting('app.current_org_id', true), '')::uuid);