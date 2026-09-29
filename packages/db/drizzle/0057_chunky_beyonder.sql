-- A reported target is reaped after a short grace so its last telemetry batch
-- lands; the row remembers when the delete was issued so the liveness sweep can
-- finish what a restarted api-server forgot. Rows terminal before this column
-- existed were reaped on completion, so they are stamped as such.
ALTER TABLE "invocations" ADD COLUMN "reaped_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "invocations_unreaped_idx" ON "invocations" USING btree ("completed_at") WHERE "invocations"."reaped_at" IS NULL;--> statement-breakpoint
UPDATE "invocations" SET "reaped_at" = "completed_at" WHERE "reaped_at" IS NULL AND "status" IN ('done', 'failed');
