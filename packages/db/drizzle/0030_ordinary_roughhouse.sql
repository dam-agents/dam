-- #3366: A Slack conversation may now be connected to several agents, so the
-- conversation id alone no longer identifies a binding. Exclusivity moves
-- rather than disappears: a conversation still admits at most one *default*
-- agent (the one a bare mention reaches), and an agent still cannot connect
-- itself to the same conversation twice.
-- created_at records when a binding was made, which gives the roster shown in
-- chat a stable order: the order the agents joined the conversation.
DROP INDEX "channels_slack_channel_unique_idx";--> statement-breakpoint
ALTER TABLE "channels" ADD COLUMN "created_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "channels_slack_agent_channel_idx" ON "channels" USING btree ("agent_id",("config"->>'slackChannelId')) WHERE "channels"."type" = 'slack';--> statement-breakpoint
CREATE UNIQUE INDEX "channels_slack_default_agent_idx" ON "channels" USING btree (("config"->>'slackChannelId')) WHERE "channels"."type" = 'slack' AND "channels"."config"->>'default' = 'true';