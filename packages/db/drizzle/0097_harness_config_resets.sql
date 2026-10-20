-- One row per Agent a one-off harness-config reset froze into its cohort, plus a
-- row for the pass itself (agent_id = '*'). Writing both in one transaction fixes
-- the cohort before any Agent is processed. The partial index serves the pass's
-- lookup of an Agent's newest queued harness-config event, pending or dispatched.
CREATE TABLE "harness_config_resets" (
	"reset" text NOT NULL,
	"agent_id" text NOT NULL,
	"applied_at" timestamp with time zone DEFAULT now() NOT NULL,
	"settled_at" timestamp with time zone,
	CONSTRAINT "harness_config_resets_reset_agent_id_pk" PRIMARY KEY("reset","agent_id")
);
--> statement-breakpoint
CREATE INDEX "runtime_events_harness_config_idx" ON "runtime_events" USING btree ("agent_id") WHERE "runtime_events"."kind" = 'harness-config';