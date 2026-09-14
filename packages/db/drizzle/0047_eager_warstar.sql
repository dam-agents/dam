-- #3585: A Schedule's Precheck decides each fire before any Session opens, so a
-- Declined Fire needs somewhere to land that is not the last-run pair -- reusing
-- it would render red as a failure and make a quiet Schedule look broken, and
-- last_fired_at would claim a run that never happened.
--
-- The two counts answer different questions and so clear on different events.
-- declined_count is since the last run: it says whether the check is still
-- finding anything. precheck_failed_count is since the script last returned a
-- verdict at all, exit 0 and exit 1 alike: a run cannot clear it, because a
-- broken Precheck is what let that run happen, and counting from the last run
-- would read one forever instead of "failing all week".
ALTER TABLE "schedules" ADD COLUMN "last_declined_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "schedules" ADD COLUMN "declined_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "schedules" ADD COLUMN "last_precheck_error" text;--> statement-breakpoint
ALTER TABLE "schedules" ADD COLUMN "precheck_failed_count" integer DEFAULT 0 NOT NULL;