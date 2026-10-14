-- The Home feed names the Slack channel or Telegram chat a session came from.
-- The thread key is the only thing that identifies the conversation, and a
-- hibernated Agent cannot be asked for it, so the attention record keeps it.
ALTER TABLE "attention_records" ADD COLUMN "thread_ts" text;
