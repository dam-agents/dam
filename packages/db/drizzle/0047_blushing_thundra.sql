-- #3585: A Schedule's Precheck decides each fire before any Session opens, so
-- a Declined Fire needs somewhere to land that is not the last-run pair. Reusing
-- last_fired_result would render red as a failure and make a quiet Schedule look
-- broken, and last_fired_at would claim a run that never happened. The count is
-- since the last run, not a lifetime total -- a run clears it -- so it answers
-- whether the check is still finding anything; last_precheck_error records a
-- Precheck that broke and let the run through anyway.
ALTER TABLE "schedules" ADD COLUMN "last_declined_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "schedules" ADD COLUMN "declined_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "schedules" ADD COLUMN "last_precheck_error" text;