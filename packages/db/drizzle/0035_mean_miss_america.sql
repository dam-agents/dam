-- A workspace-mutating event (workspace-seed, workspace-command) holds its
-- agent in preparing-workspace while it is pending, so its delivery must be
-- bounded: an event whose handler keeps failing, or whose kind the agent's
-- runtime cannot apply, would otherwise pin the agent until the event's TTL
-- (30 days for a kinded-agent install). "attempts" counts the deliveries the
-- agent answered without settling the event; once the budget is exhausted the
-- worker stamps dispatched_at and records why in "error", so the agent leaves
-- preparing-workspace and the terminal state stays distinguishable from a
-- clean settle.
ALTER TABLE "runtime_events" ADD COLUMN "attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "runtime_events" ADD COLUMN "error" text;