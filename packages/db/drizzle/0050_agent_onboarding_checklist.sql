-- The onboarding checklist a starter-kit agent reports while its onboarding is
-- pending (#3576): the steps it declared through set_onboarding_checklist and
-- which it has ticked. The api-server writes it only through those MCP tools
-- and reads it into the agent view; it lives on the agent's own row, beside
-- the other per-agent JSON state, and goes with the agent.
ALTER TABLE "agents" ADD COLUMN "onboarding_checklist" jsonb;
