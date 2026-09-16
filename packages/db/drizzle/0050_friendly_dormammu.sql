-- #3516: Slack gains one bot credential per workspace, so two things change.
--
-- slack_installs holds one row per workspace that completed the install
-- handshake. The bot token itself never lands here — it goes to a Kubernetes
-- Secret and the row only points at it, so Postgres holds no credential. The
-- install that predates this table has no row at all: it keeps being served by
-- the operator-supplied token in api-server env. That token answers for that
-- one workspace and no other — a workspace with no row is one nobody agreed to
-- serve, which is what a refused install leaves behind, and it gets nothing.
-- credential_state is an enum rather than free text because a value outside the
-- known set would read as usable and quietly serve a dead credential.
--
-- The channel indexes change because a Slack channel id is unique inside its
-- workspace, not across them, so once a second workspace is installed the old
-- indexes key on something that no longer identifies one conversation. Both now
-- carry the workspace. An absent teamId coalesces to '' and means the install's
-- original workspace, which is what every existing row is — so no backfill is
-- needed and today's bindings keep their uniqueness exactly as before.
-- identity_links is deliberately untouched: inside one enterprise Slack
-- organization a user id already identifies one person, so widening its key
-- would make anyone who ran the login command in one workspace run it again in
-- the next, and recording a workspace it does not key on would buy nothing.
CREATE TYPE "public"."slack_credential_state" AS ENUM('active', 'rejected');--> statement-breakpoint
CREATE TABLE "slack_installs" (
	"team_id" text PRIMARY KEY NOT NULL,
	"team_name" text,
	"secret_path" text NOT NULL,
	"secret_field" text NOT NULL,
	"installed_by" text,
	"credential_state" "slack_credential_state" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DROP INDEX "channels_slack_agent_channel_idx";--> statement-breakpoint
DROP INDEX "channels_slack_default_agent_idx";--> statement-breakpoint
CREATE UNIQUE INDEX "channels_slack_agent_channel_idx" ON "channels" USING btree ("agent_id",coalesce("config"->>'teamId', ''),("config"->>'slackChannelId')) WHERE "channels"."type" = 'slack';--> statement-breakpoint
CREATE UNIQUE INDEX "channels_slack_default_agent_idx" ON "channels" USING btree (coalesce("config"->>'teamId', ''),("config"->>'slackChannelId')) WHERE "channels"."type" = 'slack' AND "channels"."config"->>'default' = 'true';