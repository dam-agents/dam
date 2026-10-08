-- Facts the usage analytics report needs and the activity log could not hold.
--
-- * actor_roles.first_seen_at: the day a user first signed in. The only other
--   source is the oldest `auth` row, and the retention job deletes those after
--   180 days, which would make an old user look new again and move them into
--   the wrong cohort. actor_roles is never pruned. The column is set on insert
--   and never updated; the next migration backfills existing rows.
-- * external_actor_links: maps the pseudonymized Slack or Telegram user id that
--   a channel_turn row carries to the pseudonymized platform user it belongs to.
--   Both sides are HMACed by the api-server, which holds the key. A row is kept
--   when the user logs out of Slack, so their past turns stay attributed.
-- * activity_events_agent_oom_dedup_idx: every api-server replica watches Agent
--   status and reports the same out-of-memory restart, so the log keeps one
--   agent_oom row per Agent and UTC day.
--
-- Three facts about an Agent kept on its usage record, because the activity
-- rows that carried them are deleted after 180 days and the other records that
-- held them go with the Agent or its invocation:
-- * starter_kit: the Starter Kit the Agent was created from. Without it an old
--   kit Agent reads as built from scratch.
-- * onboarded_at: when the Agent first declared its onboarding complete.
-- * spawned_by_agent_id: the Agent that started this one as a sub-agent. The
--   invocation row is deleted when the sub-agent is reaped, after which the
--   sub-agent would count as something a user built.
-- The record is never pruned and keeps all three after the Agent is deleted.
-- The views migration that follows fills them in for existing Agents.

CREATE TABLE "external_actor_links" (
	"provider" text NOT NULL,
	"external_actor_hash" text NOT NULL,
	"actor_sub" text NOT NULL,
	"linked_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "external_actor_links_provider_external_actor_hash_pk" PRIMARY KEY("provider","external_actor_hash")
);
--> statement-breakpoint
ALTER TABLE "actor_roles" ADD COLUMN "first_seen_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "starter_kit" text;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "onboarded_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "spawned_by_agent_id" text;--> statement-breakpoint
CREATE UNIQUE INDEX "activity_events_agent_oom_dedup_idx" ON "activity_events" USING btree ("agent_id",date_trunc('day', "occurred_at" AT TIME ZONE 'UTC')) WHERE "activity_events"."type" = 'agent_oom';
