-- A Session owns the Slack threads it starts (#6271): a reply in such a
-- thread becomes a turn of that Session instead of opening a new one. The
-- record lives here so a reply is routed without waking the Agent, and a
-- restart keeps it.
CREATE TABLE "slack_owned_threads" (
	"channel_id" text NOT NULL,
	"thread_ts" text NOT NULL,
	"team_id" text NOT NULL,
	"agent_id" text NOT NULL,
	"session_id" text NOT NULL,
	"first_line" text NOT NULL,
	"delivered_up_to" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "slack_owned_threads_channel_id_thread_ts_pk" PRIMARY KEY("channel_id","thread_ts")
);
--> statement-breakpoint
CREATE INDEX "slack_owned_threads_session_idx" ON "slack_owned_threads" USING btree ("agent_id","session_id");