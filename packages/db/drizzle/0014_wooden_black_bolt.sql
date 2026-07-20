-- Invocations (#2816): the platform-owned durable record of each run-once,
-- typed request from a driver Agent to a target Agent — stashes the result
-- JSON Schema for report_result validation and holds the validated result.
-- Lifecycle (autosweep) lives on the Agent, not here. See schema.ts for the
-- rationale. (Supersedes the retired first-cut "sandboxes" table, unmerged.)
CREATE TABLE "invocations" (
	"id" text PRIMARY KEY NOT NULL,
	"driver_agent_id" text NOT NULL,
	"owner" text NOT NULL,
	"result_schema" jsonb NOT NULL,
	"result" jsonb,
	"status" text DEFAULT 'running' NOT NULL,
	"error_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE INDEX "invocations_driver_idx" ON "invocations" USING btree ("driver_agent_id");--> statement-breakpoint
CREATE INDEX "invocations_status_expiry_idx" ON "invocations" USING btree ("expires_at") WHERE "invocations"."status" = 'running';