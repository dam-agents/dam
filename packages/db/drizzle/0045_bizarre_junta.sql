-- #3431: The Contribution kinds the last delivery dropped because the agent's
-- runtime image does not advertise them. Capability filtering runs before the
-- payload hash, so a gapped delivery settles clean and leaves no other trace
-- of what the agent never received — the owner sees a healthy agent that is
-- missing credentials or network permissions it was granted. Recorded per
-- agent on the delivery that dropped them, and rewritten on every delivery, so
-- it clears itself once the image advances.
ALTER TABLE "runtime_state_outbox" ADD COLUMN "dropped_contribution_kinds" jsonb DEFAULT '[]'::jsonb NOT NULL;
