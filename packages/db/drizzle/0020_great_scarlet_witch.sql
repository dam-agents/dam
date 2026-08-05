-- #3019 review: a record that can never resolve — a private source whose agent
-- stays hibernated, a deleted repo — re-entered the candidate set every hour
-- forever, each pass spending one request of the shared anonymous GitHub
-- budget. This counts consecutive attempts that yielded no state so the
-- re-check interval can back off exponentially (hourly → capped at daily);
-- any attempt that learns something resets it to the hourly lane. Default 0:
-- every existing row starts un-backed-off, which is the honest state.
ALTER TABLE "agent_skill_publishes" ADD COLUMN "pr_state_check_failures" integer DEFAULT 0 NOT NULL;
