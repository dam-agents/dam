CREATE TABLE "agent_inheritance" (
	"agent_id" text PRIMARY KEY NOT NULL,
	"parent_agent_id" text NOT NULL,
	"connections_from" text NOT NULL,
	"egress_from" text DEFAULT 'parent' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invocation_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"invocation_id" text NOT NULL,
	"prompt" text DEFAULT '' NOT NULL,
	"script" text,
	"result_schema" jsonb,
	"ttl_ms" integer,
	"status" text DEFAULT 'running' NOT NULL,
	"result" jsonb,
	"error_reason" text,
	"exit_code" integer,
	"output" jsonb,
	"output_expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone,
	"origin" text DEFAULT 'script' NOT NULL,
	"driver_session_id" text,
	"session_id" text,
	"cancel_pending" boolean DEFAULT false NOT NULL,
	"awaited_until" timestamp with time zone,
	"claimed_until" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"woke_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "invocations" ADD COLUMN "keep_until" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "control"."agents" ADD COLUMN "link_from" text;
--> statement-breakpoint
CREATE INDEX "agent_inheritance_parent_idx" ON "agent_inheritance" USING btree ("parent_agent_id");
--> statement-breakpoint
CREATE INDEX "invocation_runs_invocation_idx" ON "invocation_runs" USING btree ("invocation_id","created_at");
--> statement-breakpoint
CREATE INDEX "invocation_runs_undelivered_idx" ON "invocation_runs" USING btree ("completed_at") WHERE "invocation_runs"."origin" = 'tool' AND "invocation_runs"."status" <> 'running' AND ("invocation_runs"."delivered_at" IS NULL OR "invocation_runs"."woke_at" IS NULL);
--> statement-breakpoint
CREATE INDEX "invocation_runs_status_expiry_idx" ON "invocation_runs" USING btree ("expires_at") WHERE "invocation_runs"."status" = 'running';
--> statement-breakpoint
CREATE INDEX "invocation_runs_output_expiry_idx" ON "invocation_runs" USING btree ("output_expires_at") WHERE "invocation_runs"."output_expires_at" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX "invocation_runs_cancel_idx" ON "invocation_runs" USING btree ("invocation_id") WHERE "invocation_runs"."cancel_pending";
--> statement-breakpoint
-- Each target's run so far becomes its first run, under the target's own id,
-- which a task, a result or a script report of a run from before runs had
-- their own rows still matches.
INSERT INTO "invocation_runs" (
	"id", "invocation_id", "prompt", "script", "result_schema", "ttl_ms",
	"status", "result", "error_reason", "exit_code", "output",
	"output_expires_at", "created_at", "started_at", "expires_at",
	"completed_at", "origin", "driver_session_id", "awaited_until",
	"claimed_until", "delivered_at", "woke_at"
)
SELECT
	"id", "id", "prompt", "script", "result_schema", "ttl_ms",
	"status", "result", "error_reason", "exit_code", "output",
	"output_expires_at", "created_at", "started_at", "expires_at",
	"completed_at", "origin", "driver_session_id", "awaited_until",
	"claimed_until", "delivered_at", "woke_at"
FROM "invocations"
WHERE "status" <> 'idle';
--> statement-breakpoint
DROP INDEX "invocations_undelivered_idx";
--> statement-breakpoint
DROP INDEX "invocations_status_expiry_idx";
--> statement-breakpoint
DROP INDEX "invocations_output_expiry_idx";
--> statement-breakpoint
DROP INDEX "invocations_unreaped_idx";
--> statement-breakpoint
CREATE INDEX "invocations_unreaped_idx" ON "invocations" USING btree ("created_at") WHERE "invocations"."reaped_at" IS NULL;
--> statement-breakpoint
ALTER TABLE "invocations" DROP COLUMN "prompt";
--> statement-breakpoint
ALTER TABLE "invocations" DROP COLUMN "result_schema";
--> statement-breakpoint
ALTER TABLE "invocations" DROP COLUMN "result";
--> statement-breakpoint
ALTER TABLE "invocations" DROP COLUMN "script";
--> statement-breakpoint
ALTER TABLE "invocations" DROP COLUMN "exit_code";
--> statement-breakpoint
ALTER TABLE "invocations" DROP COLUMN "output";
--> statement-breakpoint
ALTER TABLE "invocations" DROP COLUMN "output_expires_at";
--> statement-breakpoint
ALTER TABLE "invocations" DROP COLUMN "status";
--> statement-breakpoint
ALTER TABLE "invocations" DROP COLUMN "error_reason";
--> statement-breakpoint
ALTER TABLE "invocations" DROP COLUMN "completed_at";
--> statement-breakpoint
ALTER TABLE "invocations" DROP COLUMN "started_at";
--> statement-breakpoint
ALTER TABLE "invocations" DROP COLUMN "origin";
--> statement-breakpoint
ALTER TABLE "invocations" DROP COLUMN "awaited_until";
--> statement-breakpoint
ALTER TABLE "invocations" DROP COLUMN "claimed_until";
--> statement-breakpoint
ALTER TABLE "invocations" DROP COLUMN "delivered_at";
--> statement-breakpoint
ALTER TABLE "invocations" DROP COLUMN "woke_at";
--> statement-breakpoint
-- The one Agent that may open the link into this one's machine is set at
-- create and never changes, as environment_of.
CREATE OR REPLACE FUNCTION control.agents_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id THEN
    RAISE EXCEPTION 'control.agents.id is immutable (agent %)', OLD.id;
  END IF;
  IF NEW.owner_sub IS DISTINCT FROM OLD.owner_sub THEN
    RAISE EXCEPTION 'control.agents.owner_sub is immutable (agent %)', OLD.id;
  END IF;
  IF NEW.incarnation IS DISTINCT FROM OLD.incarnation THEN
    RAISE EXCEPTION 'control.agents.incarnation is immutable (agent %)', OLD.id;
  END IF;
  IF NEW.environment_of IS DISTINCT FROM OLD.environment_of THEN
    RAISE EXCEPTION 'control.agents.environment_of is immutable (agent %)', OLD.id;
  END IF;
  IF NEW.link_from IS DISTINCT FROM OLD.link_from THEN
    RAISE EXCEPTION 'control.agents.link_from is immutable (agent %)', OLD.id;
  END IF;

  IF (NEW.image, NEW.harness, NEW.image_pull_secret_ref, NEW.secret_ref,
      NEW.hibernation_timeout_ns, NEW.nested_virtualization,
      NEW.require_connection_address, NEW.telemetry_attribution_id,
      NEW.cpu_limit, NEW.memory_limit, NEW.disk_size, NEW.sweepable)
     IS DISTINCT FROM
     (OLD.image, OLD.harness, OLD.image_pull_secret_ref, OLD.secret_ref,
      OLD.hibernation_timeout_ns, OLD.nested_virtualization,
      OLD.require_connection_address, OLD.telemetry_attribution_id,
      OLD.cpu_limit, OLD.memory_limit, OLD.disk_size, OLD.sweepable)
  THEN
    NEW.generation := OLD.generation + 1;
  END IF;

  IF NEW.hibernation_timeout_ns IS DISTINCT FROM OLD.hibernation_timeout_ns
     OR NEW.sweepable IS DISTINCT FROM OLD.sweepable
  THEN
    UPDATE control.agent_signals SET version = version WHERE agent_id = NEW.id;
  END IF;

  RETURN NEW;
END $$;
