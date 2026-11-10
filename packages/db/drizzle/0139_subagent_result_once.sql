-- A sub-agent's result reaches its Driver once: as the answer to an
-- await_subagents call, or in one sub-agent-outcome turn when nothing waits.
-- `delivered_in_turn` marks a run whose turn carried its outcome whole, so a
-- wait the mesh cut and the agent called again names it as delivered instead
-- of returning the result a second time beside the turn. A run a wait
-- returned keeps false, and a wait asked again still answers it.
ALTER TABLE "invocation_runs" ADD COLUMN "delivered_in_turn" boolean DEFAULT false NOT NULL;
