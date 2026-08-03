-- Collapse the experiment data model to a single shared prompt. The old `goal`
-- (prose objective) and `spec` (jsonb that only ever held a task + budgets) were
-- three overlapping ways to say the same thing; budgets are gone (unenforced) and
-- the task is the common instruction every arm receives. `prompt` replaces both.
-- Per-arm config stays in experiment_arms.arm_spec. Greenfield drop, no back-compat.
ALTER TABLE "experiments" ADD COLUMN "prompt" text NOT NULL;--> statement-breakpoint
ALTER TABLE "experiments" DROP COLUMN "goal";--> statement-breakpoint
ALTER TABLE "experiments" DROP COLUMN "spec";