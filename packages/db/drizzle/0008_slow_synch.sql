-- dam-u1n.13: per-arm status makes Experiment completion representable. Before
-- this, only experiment-level status existed, so "this arm finished" could not
-- be recorded and an Experiment stayed `running` forever. `status` carries the
-- per-arm lifecycle (pending -> running -> completed | failed | stopped) and
-- `last_activity_at` is the liveness clock the inactivity-deadline sweep reads
-- (partial index covers exactly the running arms it scans). Existing arms
-- default to `pending`; the start path moves them to `running`.
ALTER TABLE "experiment_arms" ADD COLUMN "status" text DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "experiment_arms" ADD COLUMN "last_activity_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "experiment_arms_running_activity_idx" ON "experiment_arms" USING btree ("last_activity_at") WHERE "experiment_arms"."status" = 'running';