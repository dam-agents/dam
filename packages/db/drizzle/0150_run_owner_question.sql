-- A sub-agent's run can end by asking its owner a question (#4205): the question and its deadline on the run that asked, the run that continues from the answer, and the answer on that run.
ALTER TABLE "invocation_runs" ADD COLUMN "question" jsonb;--> statement-breakpoint
ALTER TABLE "invocation_runs" ADD COLUMN "answer_by" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "invocation_runs" ADD COLUMN "continued_by" text;--> statement-breakpoint
ALTER TABLE "invocation_runs" ADD COLUMN "answer" jsonb;--> statement-breakpoint
CREATE INDEX "invocation_runs_asking_idx" ON "invocation_runs" USING btree ("answer_by") WHERE "invocation_runs"."status" = 'asking';