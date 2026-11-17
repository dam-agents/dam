-- The Schedules the platform gave a person's assistant, one row per person
-- and kind: the Agent, the Schedule, and the last alert a run of it raised.
-- The first kind is the weekly security check.
CREATE TABLE "assistant_schedules" (
	"owner" text NOT NULL,
	"kind" text NOT NULL,
	"agent_id" text NOT NULL,
	"schedule_id" text,
	"items" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"reported_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "assistant_schedules_owner_kind_pk" PRIMARY KEY("owner","kind")
);
--> statement-breakpoint
CREATE INDEX "assistant_schedules_agent_idx" ON "assistant_schedules" USING btree ("agent_id");