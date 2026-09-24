-- The Invocation row is the durable delegation record: it lives for its root
-- driver's lifetime and carries what the target was given. Rows written before
-- this column existed take their driver as root, the closest ancestor on record.
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
CREATE INDEX "invocations_root_driver_idx" ON "invocations" USING btree ("root_driver_id");