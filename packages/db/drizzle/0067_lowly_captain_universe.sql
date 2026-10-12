-- Agents in a Slack channel can ignore posts from one app or webhook.
-- The list is per channel, keyed by the app's bot id, so it holds for every
-- Agent connected there, including ones connected later.
CREATE TABLE "slack_ignored_apps" (
	"channel_id" text NOT NULL,
	"bot_id" text NOT NULL,
	"name" text NOT NULL,
	"ignored_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "slack_ignored_apps_channel_id_bot_id_pk" PRIMARY KEY("channel_id","bot_id")
);
