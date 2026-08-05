-- #3139 follow-up: set once the anonymous read has 404'd, so later attempts
-- skip the anonymous request (which would re-learn the same 404 out of the
-- shared 60/hour budget) and go straight to a publishing agent's pod.
ALTER TABLE "agent_skill_publishes" ADD COLUMN "pr_needs_pod" boolean DEFAULT false NOT NULL;