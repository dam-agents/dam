-- Remove the arms-racing Experiments subsystem (#2822). Superseded by the
-- loops-as-code direction (#2821/#2942): experiments rebase onto driver loop
-- scripts observed via skeleton + trace, so the v1 arms/runs data model goes
-- away. Destructive by design — Experiments was an opt-in experimental
-- feature; stored v1 experiment data is dropped, not migrated.
DROP TABLE "experiment_arms" CASCADE;--> statement-breakpoint
DROP TABLE "experiment_runs" CASCADE;--> statement-breakpoint
DROP TABLE "experiments" CASCADE;