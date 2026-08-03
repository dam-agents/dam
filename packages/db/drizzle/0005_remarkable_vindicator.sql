-- Experiments bounded context. An experiment races several R&D harness arms
-- against one goal and collects their scored runs. Mirrors the connections +
-- connection_grants owner/grant shape:
--   experiments      — owner-scoped resource (goal + opaque shared spec + status),
--                      unique per (owner, name), peer to the agent.
--   experiment_arms  — one competitor per (experiment, agent): the harness image
--                      plus an opaque arm_spec config. Same harness may appear
--                      twice with different configs, so the agent keys the arm.
--   experiment_runs  — the shared per-arm ledger. Each run carries only a score
--                      (jsonb, opaque to the platform) and a candidate_ref (path
--                      on the artifact PVC); run_number is the per-arm sequence,
--                      session_id ties it to the arm's Trial session. score /
--                      candidate_ref / ended_at stay nullable so a row can exist
--                      while the run is still in flight.
CREATE TABLE "experiment_arms" (
	"experiment_id" text NOT NULL,
	"agent_id" text NOT NULL,
	"arm_spec" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "experiment_arms_experiment_id_agent_id_pk" PRIMARY KEY("experiment_id","agent_id")
);
--> statement-breakpoint
CREATE TABLE "experiment_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"experiment_id" text NOT NULL,
	"agent_id" text NOT NULL,
	"run_number" integer NOT NULL,
	"session_id" text NOT NULL,
	"candidate_ref" text,
	"score" jsonb,
	"status" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "experiments" (
	"id" text PRIMARY KEY NOT NULL,
	"owner" text NOT NULL,
	"name" text NOT NULL,
	"goal" text NOT NULL,
	"spec" jsonb NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "experiment_arms_agent_idx" ON "experiment_arms" USING btree ("agent_id");--> statement-breakpoint
CREATE UNIQUE INDEX "experiment_runs_arm_run_number_idx" ON "experiment_runs" USING btree ("experiment_id","agent_id","run_number");--> statement-breakpoint
CREATE INDEX "experiments_owner_idx" ON "experiments" USING btree ("owner");--> statement-breakpoint
CREATE UNIQUE INDEX "experiments_owner_name_unique_idx" ON "experiments" USING btree ("owner","name");