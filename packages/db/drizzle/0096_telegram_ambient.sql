-- Whether a bound Telegram chat runs in ambient mode: the agent reads every
-- message and chimes in when it can help. Off by default, as on Slack, so an
-- existing chat keeps answering only what is addressed to the agent.
ALTER TABLE "telegram_conversations" ADD COLUMN "ambient" boolean DEFAULT false NOT NULL;
