-- Platform-wide Telegram bot: a conversation (chat, or forum topic) binds to
-- exactly one Agent — the PK on conversation_id is the binding's uniqueness,
-- and authorized_by keeps the owner sub whose ToU acceptance gates turns.
-- telegram_threads held per-agent-bot authorizations that are meaningless
-- under the shared bot; dropped without migration — chats re-/login. The
-- trailing DELETE sweeps the per-agent `channels` telegram marker rows
-- (their bot-token Secrets are removed by the Helm pre-upgrade hook).
CREATE TABLE "telegram_conversations" (
	"conversation_id" text PRIMARY KEY NOT NULL,
	"agent_id" text NOT NULL,
	"authorized_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DROP TABLE "telegram_threads" CASCADE;--> statement-breakpoint
CREATE INDEX "telegram_conversations_agent_idx" ON "telegram_conversations" USING btree ("agent_id");--> statement-breakpoint
DELETE FROM "channels" WHERE "type" = 'telegram';