-- Usage views derived from the sessions table (ADR-048). Sessions are now
-- agent-owned (ADR-055) and there is no session-lifecycle event stream to
-- re-source these from, so they retire with the table. Must drop before the
-- table — Postgres refuses to drop a table with dependent views.
DROP VIEW IF EXISTS "usage_sessions_by_type_30d";--> statement-breakpoint
DROP VIEW IF EXISTS "usage_sessions_by_mode_30d";--> statement-breakpoint
DROP VIEW IF EXISTS "usage_active_agents_7d";--> statement-breakpoint
DROP VIEW IF EXISTS "usage_sessions_by_agent_30d";--> statement-breakpoint
DROP VIEW IF EXISTS "usage_session_active_span";--> statement-breakpoint
DROP TABLE IF EXISTS "sessions";--> statement-breakpoint
DROP TYPE IF EXISTS "session_mode";
