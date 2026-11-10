-- The first result the person's onboarding reached, as their assistant reported it
-- over its own Connection: a schedule set, an artifact made, a saved knowledge
-- base; what the assistant called it; and when. `first_result_completed_at` is the
-- side effects' own mark — the checklist write and the announcement — written in the
-- same transaction as the claim, so nothing uncompleted can outlive a report.
-- `onboarding_epoch` counts the person's onboarding resets: it is bumped by the
-- reset, which clears the result with it, so a report that began in an earlier
-- onboarding can tell it no longer applies. A number rather than a timestamp,
-- because a timestamp compares two clocks' microseconds and a number compares the
-- thing itself.
ALTER TABLE "dambledore_provisioned" ADD COLUMN "first_result_kind" text;--> statement-breakpoint
ALTER TABLE "dambledore_provisioned" ADD COLUMN "first_result_ref" text;--> statement-breakpoint
ALTER TABLE "dambledore_provisioned" ADD COLUMN "first_result_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "dambledore_provisioned" ADD COLUMN "first_result_completed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "dambledore_provisioned" ADD COLUMN "onboarding_epoch" integer DEFAULT 0 NOT NULL;