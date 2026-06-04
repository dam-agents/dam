-- Contributions-Settled gate. Splits the apply cursor — `last_settled_version`
-- advances on every terminated cycle (drives the readiness gate), distinct from the
-- clean-only `last_applied_version` — and records failing drivers (`apply_failures`)
-- plus a capped background-retry counter (`apply_attempts`). The former stale-detection
-- index is repurposed to scan rows with outstanding work. Additive; defaults backfill.

ALTER TABLE "runtime_state_outbox" ADD COLUMN "last_settled_version" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "runtime_state_outbox" ADD COLUMN "apply_failures" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "runtime_state_outbox" ADD COLUMN "apply_attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
DROP INDEX "runtime_state_outbox_stale_idx";--> statement-breakpoint
CREATE INDEX "runtime_state_outbox_retry_idx" ON "runtime_state_outbox" USING btree ("apply_attempts") WHERE "runtime_state_outbox"."apply_failures" <> '[]'::jsonb OR "runtime_state_outbox"."last_settled_version" < "runtime_state_outbox"."version";
