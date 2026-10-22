-- An Agent keeps a default for channel turns and one for schedule fires beside
-- its chat default (session_pair); null means the kind runs on the chat default.
ALTER TABLE "agents" ADD COLUMN "channel_session_pair" jsonb;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "scheduled_session_pair" jsonb;
