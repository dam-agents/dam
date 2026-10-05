ALTER TABLE "invocations" ADD COLUMN "origin" text DEFAULT 'script' NOT NULL;--> statement-breakpoint
ALTER TABLE "invocations" ADD COLUMN "awaited_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "invocations" ADD COLUMN "delivered_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "invocations" ADD COLUMN "woke_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "invocations_undelivered_idx" ON "invocations" USING btree ("completed_at") WHERE "invocations"."origin" = 'tool' AND "invocations"."status" <> 'running' AND ("invocations"."delivered_at" IS NULL OR "invocations"."woke_at" IS NULL);