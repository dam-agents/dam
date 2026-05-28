-- ADR-053 §"the schedule firing path now belongs to ... an api-server cron".
--
-- Schedules move from K8s ConfigMaps (controller-owned cron) into Postgres,
-- where the api-server's BullMQ self-rescheduling worker fires them. The
-- controller's `pkg/scheduler/` package retires in the same change.
--
-- `spec` is the wire shape (`scheduleSpecSchema` in api-server-api) held
-- opaquely as jsonb — discriminated union over cron + rrule kinds.

CREATE TABLE "schedules" (
	"id" text PRIMARY KEY NOT NULL,
	"agent_id" text NOT NULL,
	"owner" text NOT NULL,
	"name" text NOT NULL,
	"spec" jsonb NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"next_run" timestamp with time zone,
	"last_fired_at" timestamp with time zone,
	"last_fired_result" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "schedules_agent_owner_idx" ON "schedules" USING btree ("agent_id","owner");--> statement-breakpoint
CREATE INDEX "schedules_enabled_idx" ON "schedules" USING btree ("id") WHERE "schedules"."enabled" = true;
