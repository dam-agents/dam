-- The Experiments feature is removed: its drafts, runs and spans go, and nothing
-- ties an invocation or an attention record to an experiment any more. Their
-- artifacts live in the artifact library and stay.
ALTER TABLE "experiment_spans" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "experiments" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "experiment_spans" CASCADE;--> statement-breakpoint
DROP TABLE "experiments" CASCADE;--> statement-breakpoint
DROP INDEX "invocations_experiment_span_idx";--> statement-breakpoint
ALTER TABLE "attention_records" DROP COLUMN "experiment_id";--> statement-breakpoint
ALTER TABLE "invocations" DROP COLUMN "experiment_span_id";