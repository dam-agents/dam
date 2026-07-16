-- Campaign loop nodes (#2784): the platform-owned durable record of each
-- ephemeral sandbox Agent — stashes the result JSON Schema for node_done
-- validation and holds the validated result. See schema.ts for the rationale.
CREATE TABLE "sandboxes" (
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
CREATE INDEX "sandboxes_driver_idx" ON "sandboxes" USING btree ("driver_agent_id");--> statement-breakpoint
CREATE INDEX "sandboxes_status_expiry_idx" ON "sandboxes" USING btree ("expires_at") WHERE "sandboxes"."status" = 'running';