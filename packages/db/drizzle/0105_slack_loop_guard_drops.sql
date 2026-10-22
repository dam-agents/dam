-- One row per Slack conversation where the loop guard dropped a bot or app
-- post, so the Channels page of every Agent connected there can say so. The
-- guard itself counts in the leader's memory; this is only its record.
CREATE TABLE "slack_loop_guard_drops" (
	"channel_id" text PRIMARY KEY NOT NULL,
	"dropped" integer NOT NULL,
	"last_dropped_at" timestamp with time zone NOT NULL,
	"recent" jsonb NOT NULL
);
