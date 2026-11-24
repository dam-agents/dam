-- How much the person chose a run of an assistant Schedule to do, in the
-- kind's own words: for the security check, the effort of the run and whether
-- it may ask the owner's other agents. A row from before the choice has none
-- and runs at the kind's default, which asks no agent.
ALTER TABLE "assistant_schedules" ADD COLUMN "level" text;
