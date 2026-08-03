-- Experiments v2 (#2942): the whole observation data model in one migration
-- (squashed pre-merge from the branch's incremental steps). One row per
-- Experiment — a draft (the lineage's persistent buildable) or a run (an
-- immutable capture: skeleton, drift, script-artifact reference, lifecycle,
-- run-attached artifacts, post_data blob) — plus one row per Span (a stage
-- execution carrying status/score/artifact refs), and the invocations span
-- attach ("<experimentId>/<spanId>") that joins spawns into the Trace Feed.
-- Script source is never stored here — it lives versioned in the Artifact
-- Library. The partial unique index enforces one draft per (driver, name).

CREATE TABLE "experiment_spans" (
	"id" text PRIMARY KEY NOT NULL,
	"experiment_id" text NOT NULL,
	"span_id" text NOT NULL,
	"stage" text NOT NULL,
	"iteration" integer,
	"parent_span_id" text,
	"status" text DEFAULT 'running' NOT NULL,
	"score" double precision,
	"artifact_ids" jsonb,
	"attrs" jsonb,
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "experiments" (
	"id" text PRIMARY KEY NOT NULL,
	"owner" text NOT NULL,
	"driver_agent_id" text NOT NULL,
	"name" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"skeleton" jsonb NOT NULL,
	"drift" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"script_path" text NOT NULL,
	"script_sha256" text NOT NULL,
	"script_artifact_id" text NOT NULL,
	"script_version" integer NOT NULL,
	"dashboard_artifact_id" text,
	"custom_data" jsonb,
	"attached_artifact_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"executed_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"last_activity_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "invocations" ADD COLUMN "experiment_span_id" text;--> statement-breakpoint
ALTER TABLE "experiment_spans" ADD CONSTRAINT "experiment_spans_experiment_id_experiments_id_fk" FOREIGN KEY ("experiment_id") REFERENCES "public"."experiments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "experiment_spans_experiment_started_idx" ON "experiment_spans" USING btree ("experiment_id","started_at");--> statement-breakpoint
CREATE INDEX "experiment_spans_experiment_stage_idx" ON "experiment_spans" USING btree ("experiment_id","stage");--> statement-breakpoint
CREATE INDEX "experiments_owner_idx" ON "experiments" USING btree ("owner");--> statement-breakpoint
CREATE UNIQUE INDEX "experiments_driver_name_draft_idx" ON "experiments" USING btree ("driver_agent_id","name") WHERE "experiments"."status" = 'draft';--> statement-breakpoint
CREATE INDEX "experiments_running_activity_idx" ON "experiments" USING btree ("last_activity_at") WHERE "experiments"."status" = 'running';--> statement-breakpoint
CREATE INDEX "experiments_running_driver_idx" ON "experiments" USING btree ("driver_agent_id") WHERE "experiments"."status" = 'running';--> statement-breakpoint
CREATE INDEX "invocations_experiment_span_idx" ON "invocations" USING btree ("experiment_span_id") WHERE "invocations"."experiment_span_id" IS NOT NULL;