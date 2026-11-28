-- An API key can belong to an Agent: a call made with it is that Agent's call,
-- and the security log names the Agent. Only the platform issues such a key,
-- as the derived credential of a scoped grant of the platform Connection.
-- No backfill: every existing key belongs to its owner alone, as before. The
-- key is revoked when its Agent is deleted, so no foreign key is needed.
ALTER TABLE "api_keys" ADD COLUMN "agent_id" text;