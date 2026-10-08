-- A session chooses its harness, model provider and model. The pair a person
-- last picked on an Agent preselects the next session's and is what its
-- schedules and channel turns run on. Null until someone picks: the Agent's
-- own harness and first granted provider stand in.
ALTER TABLE "agents" ADD COLUMN "session_pair" jsonb;
