-- A Slack DM Bridge is a pairing an operator vouched for and a person later
-- asked to undo, so its record outlives the Slack lookups and the binding it
-- created: the state is what stops turns and delivery after a revoke, and what
-- makes a half-done revoke finishable on retry. Its generation tells a revoke
-- that a later connect superseded it, and its greeting columns carry the claim
-- — with the token that owns it — and the recorded post, so a crash strands a
-- stale claim rather than a repeat, and a superseded sender cannot finish
-- someone else's attempt.
--
-- `identity_links.source` says how a link was proven (`oauth` by a Keycloak
-- sign-in, `email` by that pairing). `slack_installs.enterprise_id` is the
-- Slack organization the install handshake reported: an id for a workspace in
-- one, an empty string for a workspace the handshake said stands alone, and
-- null for an identity nothing recorded (a token imported from Helm, or an
-- install older than this column) — which refuses the Bridge entirely until the
-- workspace is installed again.
CREATE TYPE "public"."slack_dm_bridge_state" AS ENUM('active', 'revoking', 'revoked');--> statement-breakpoint
CREATE TABLE "slack_dm_bridges" (
	"agent_id" text NOT NULL,
	"team_id" text NOT NULL,
	"dm_channel_id" text NOT NULL,
	"owner_sub" text NOT NULL,
	"slack_user_id" text NOT NULL,
	"state" "slack_dm_bridge_state" DEFAULT 'active' NOT NULL,
	"generation" integer DEFAULT 1 NOT NULL,
	"hello_claimed_at" timestamp with time zone,
	"hello_claim_token" text,
	"hello_posted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "slack_dm_bridges_agent_id_team_id_dm_channel_id_pk" PRIMARY KEY("agent_id","team_id","dm_channel_id")
);
--> statement-breakpoint
ALTER TABLE "identity_links" ADD COLUMN "source" text DEFAULT 'oauth' NOT NULL;--> statement-breakpoint
ALTER TABLE "slack_installs" ADD COLUMN "enterprise_id" text;--> statement-breakpoint
CREATE INDEX "slack_dm_bridges_owner_idx" ON "slack_dm_bridges" USING btree ("owner_sub");--> statement-breakpoint
CREATE INDEX "slack_dm_bridges_dm_idx" ON "slack_dm_bridges" USING btree ("team_id","dm_channel_id");