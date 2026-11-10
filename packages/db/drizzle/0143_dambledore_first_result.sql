-- The first result the person's onboarding reached, as their assistant reported
-- it over its own Connection: a schedule set, an artifact made, a saved knowledge
-- base; what the assistant called it; and when.
-- (This migration grows with the rest of the feature — the completion mark and the
-- onboarding epoch — in the commits that follow; it has never been installed
-- anywhere, so it stays one statement set.)
-- The onboarding reset clears it.
ALTER TABLE "dambledore_provisioned" ADD COLUMN "first_result_kind" text;--> statement-breakpoint
ALTER TABLE "dambledore_provisioned" ADD COLUMN "first_result_ref" text;--> statement-breakpoint
ALTER TABLE "dambledore_provisioned" ADD COLUMN "first_result_at" timestamp with time zone;