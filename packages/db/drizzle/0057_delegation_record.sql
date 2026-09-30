-- The Invocation row is the durable delegation record: it lives for its root
-- driver's lifetime and carries what the target was given, and it remembers
-- when its target's delete was issued so the liveness sweep can finish what a
-- restarted api-server forgot. Rows written before these columns existed take
-- their driver as root, and terminal ones were reaped on completion.
ALTER TABLE "invocations" ADD COLUMN "root_driver_id" text;--> statement-breakpoint
UPDATE "invocations" SET "root_driver_id" = "driver_agent_id" WHERE "root_driver_id" IS NULL;--> statement-breakpoint
ALTER TABLE "invocations" ALTER COLUMN "root_driver_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "invocations" ADD COLUMN "label" text;--> statement-breakpoint
ALTER TABLE "invocations" ADD COLUMN "prompt" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "invocations" ADD COLUMN "template_id" text;--> statement-breakpoint
ALTER TABLE "invocations" ADD COLUMN "image" text;--> statement-breakpoint
ALTER TABLE "invocations" ADD COLUMN "connections" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "invocations" ADD COLUMN "cpu" text;--> statement-breakpoint
ALTER TABLE "invocations" ADD COLUMN "memory" text;--> statement-breakpoint
ALTER TABLE "invocations" ADD COLUMN "ttl_ms" integer;--> statement-breakpoint
ALTER TABLE "invocations" ADD COLUMN "reaped_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "invocations" ADD COLUMN "transcript_captured" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "invocations" ADD COLUMN "transcript_truncated" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX "invocations_root_driver_idx" ON "invocations" USING btree ("root_driver_id");--> statement-breakpoint
CREATE INDEX "invocations_unreaped_idx" ON "invocations" USING btree ("completed_at") WHERE "invocations"."reaped_at" IS NULL;--> statement-breakpoint
UPDATE "invocations" SET "reaped_at" = "completed_at" WHERE "reaped_at" IS NULL AND "status" IN ('done', 'failed');
