-- #3019: a publish record only ever attested that a publish happened, so the
-- badge claimed "Published" forever — even after the pull request was merged or
-- closed. These columns hold the pull request's *resolved* state, re-read from
-- GitHub by a periodic job. All nullable with no default: null means "never
-- resolved", the honest state for every row that exists today. `pr_etag` makes
-- the re-read conditional, which saves bandwidth only: measured against
-- api.github.com, an anonymous 304 is charged against the rate limit exactly
-- like a 200, so ETags are NOT a budget mechanism here. What bounds cost is
-- `pr_state_checked_at`, which records the last *attempt* so a record that
-- cannot resolve backs off instead of spending the budget every tick.
ALTER TABLE "agent_skill_publishes" ADD COLUMN "pr_state" text;--> statement-breakpoint
ALTER TABLE "agent_skill_publishes" ADD COLUMN "pr_state_checked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "agent_skill_publishes" ADD COLUMN "pr_etag" text;