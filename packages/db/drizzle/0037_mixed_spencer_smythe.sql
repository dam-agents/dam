-- #2887: Where an interactive page asks. By default a page asks in the
-- conversation it was first used in: `session_id` is written once, on the
-- page's first ask, and never rewritten, so a page that was answered in one
-- chat cannot later start driving another. Null means no conversation was open
-- at that first ask, or the page is `own_session`, and the page asks in its own
-- Artifact Session instead. Every row published before this migration is null,
-- so every existing page keeps the behaviour it has today.
--
-- `own_session` is settled at create like `interactive`: true for a page built
-- to outlive the chat that made it (a dashboard, a poll, a status board), which
-- needs a home of its own because the chat is gone by the time it asks.

ALTER TABLE "library_artifacts" ADD COLUMN "own_session" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "library_artifacts" ADD COLUMN "session_id" text;
