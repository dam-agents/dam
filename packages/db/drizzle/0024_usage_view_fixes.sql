-- Usage view corrections. Four independent fixes, each recorded where the
-- misleading thing was:
--
--   1. Connection views keyed on the wrong column. `connectionKey` is a random
--      per-connection id, so grouping by it produced one row per grant with
--      distinct_users=1 forever — the views could never answer "which
--      providers do people connect". They now key on the provider
--      (`templateId`), which the events started carrying alongside it.
--   2. Backfill of that provider for rows written before the events carried it.
--   3. Egress view had no core-team filter (the only pilot view that didn't).
--   4. Auth and schedule columns named for something other than what they hold.
--
-- Views are dropped and recreated rather than replaced: CREATE OR REPLACE VIEW
-- cannot rename or reorder columns, and most of these do both. The two
-- usage_core_* helpers are untouched, so nothing needs dropping in dependency
-- order here.

-- ----------------------------------------------------------------------------
-- 1. Backfill `templateId` into pre-existing connection rows
--
-- Recovers the provider by joining the surviving `connections` row. That is
-- the ONLY recovery available, and it reaches exactly one population:
-- `connection_added` rows for connections that still exist.
--
-- Everything else is unrecoverable, because `connections` rows are HARD-deleted
-- on disconnect:
--   * `connection_removed` rows — a removal implies the row is already gone, so
--     there is nothing to join to. (Recovering these from their matching add
--     row does not work either: that add row is unreachable for the same
--     reason. Connection ids are freshly random and never caller-supplied, so
--     an id is never reused and no later row can stand in for an earlier one.)
--   * `connection_added` rows for connections created and deleted before this
--     migration.
--
-- Those keep a null templateId and read as 'unknown' in the views below —
-- visibly incomplete rather than a silent undercount. Rows written after this
-- ships carry the provider on the event itself and need no join at all.
-- ----------------------------------------------------------------------------

UPDATE activity_events ae
SET payload = ae.payload || jsonb_build_object('templateId', c.template_id)
FROM connections c
WHERE ae.type = 'connection_added'
  AND ae.payload->>'templateId' IS NULL
  AND ae.payload->>'connectionKey' = c.id;
--> statement-breakpoint

-- ----------------------------------------------------------------------------
-- 2. Connection views, re-keyed on the provider
--
-- `usage_connections_by_key` is renamed to `usage_connections_by_provider`:
-- "key" named the random grant id, which is precisely the thing that made the
-- view useless. Counts here are CONNECT actions, not re-authorizations — a
-- re-grant against an existing connection emits nothing (only a first
-- authorization does), so a user reconnecting an expired token does not
-- inflate these.
-- ----------------------------------------------------------------------------

DROP VIEW IF EXISTS "usage_connections_by_key";--> statement-breakpoint
DROP VIEW IF EXISTS "usage_connections_by_user";--> statement-breakpoint
DROP VIEW IF EXISTS "usage_connection_churn_by_user";--> statement-breakpoint

CREATE VIEW "usage_connections_by_provider" AS
  SELECT
    COALESCE(payload->>'templateId', 'unknown') AS template_id,
    surface AS kind,
    COUNT(DISTINCT actor_sub) AS distinct_users,
    COUNT(*) AS connect_count,
    MAX(occurred_at) AS last_connected
  FROM activity_events
  WHERE type = 'connection_added'
    AND actor_sub IS NOT NULL
    AND actor_sub NOT IN (SELECT actor_sub FROM usage_core_actor_subs)
  GROUP BY template_id, kind
  ORDER BY distinct_users DESC;
--> statement-breakpoint

CREATE VIEW "usage_connections_by_user" AS
  SELECT
    actor_sub,
    array_agg(
      DISTINCT COALESCE(payload->>'templateId', 'unknown')
      ORDER BY COALESCE(payload->>'templateId', 'unknown')
    ) AS providers,
    COUNT(DISTINCT COALESCE(payload->>'templateId', 'unknown')) AS distinct_provider_count,
    COUNT(DISTINCT payload->>'connectionKey') AS connection_count,
    MIN(occurred_at) AS first_connected,
    MAX(occurred_at) AS last_connected
  FROM activity_events
  WHERE type = 'connection_added'
    AND actor_sub IS NOT NULL
    AND actor_sub NOT IN (SELECT actor_sub FROM usage_core_actor_subs)
  GROUP BY actor_sub
  ORDER BY distinct_provider_count DESC;
--> statement-breakpoint

-- Adds vs removes per user. Both sides are now emitted for every auth kind
-- (they were not: only OAuth-callback completions used to emit an add, while
-- every delete emitted a remove — which could make removes exceed adds).
CREATE VIEW "usage_connection_churn_by_user" AS
  SELECT
    actor_sub,
    COUNT(*) FILTER (WHERE type = 'connection_added') AS adds,
    COUNT(*) FILTER (WHERE type = 'connection_removed') AS removes,
    COUNT(DISTINCT COALESCE(payload->>'templateId', 'unknown'))
      FILTER (WHERE type = 'connection_added') AS providers_added,
    COUNT(DISTINCT COALESCE(payload->>'templateId', 'unknown'))
      FILTER (WHERE type = 'connection_removed') AS providers_removed
  FROM activity_events
  WHERE type IN ('connection_added', 'connection_removed')
    AND actor_sub IS NOT NULL
    AND actor_sub NOT IN (SELECT actor_sub FROM usage_core_actor_subs)
  GROUP BY actor_sub
  ORDER BY adds DESC;
--> statement-breakpoint

-- ----------------------------------------------------------------------------
-- 3. Egress view — core-team filter
--
-- Was the one pilot view mixing platform-team traffic into the numbers.
-- egress_rules keys on the agent, so it filters through usage_core_agents like
-- every other agent-scoped view.
-- ----------------------------------------------------------------------------

DROP VIEW IF EXISTS "usage_egress_hosts_by_agent";--> statement-breakpoint

CREATE VIEW "usage_egress_hosts_by_agent" AS
  SELECT
    agent_id,
    COUNT(DISTINCT host) AS distinct_hosts,
    COUNT(*) FILTER (WHERE status = 'active') AS active_rules,
    COUNT(*) FILTER (WHERE verdict = 'allow') AS allow_rules,
    COUNT(*) FILTER (WHERE verdict = 'deny') AS deny_rules
  FROM egress_rules
  WHERE agent_id NOT IN (SELECT agent_id FROM usage_core_agents)
  GROUP BY agent_id
  ORDER BY distinct_hosts DESC;
--> statement-breakpoint

-- ----------------------------------------------------------------------------
-- 4a. Auth views — columns renamed to what they actually hold
--
-- A partial unique index collapses auth rows to one per (sub, surface, UTC
-- day), so COUNT(*) over type='auth' is a count of ACTIVE DAYS, never of
-- logins. The old `auth_events` / `auth_count` names invited reading them as
-- login counts. Nothing about the data changes here — only the labels.
-- ----------------------------------------------------------------------------

DROP VIEW IF EXISTS "usage_auth_users_7d";--> statement-breakpoint
DROP VIEW IF EXISTS "usage_auth_surface_by_user";--> statement-breakpoint
DROP VIEW IF EXISTS "usage_auth_by_source_7d";--> statement-breakpoint
DROP VIEW IF EXISTS "usage_auth_by_source_day_7d";--> statement-breakpoint
DROP VIEW IF EXISTS "usage_multi_surface_users";--> statement-breakpoint

CREATE VIEW "usage_auth_users_7d" AS
  SELECT
    actor_sub,
    MIN(occurred_at) AS first_seen,
    MAX(occurred_at) AS last_seen,
    COUNT(*) AS active_days
  FROM activity_events
  WHERE type = 'auth'
    AND occurred_at >= NOW() - INTERVAL '7 days'
    AND actor_sub IS NOT NULL
    AND actor_sub NOT IN (SELECT actor_sub FROM usage_core_actor_subs)
  GROUP BY actor_sub;
--> statement-breakpoint

CREATE VIEW "usage_auth_surface_by_user" AS
  SELECT
    actor_sub,
    surface,
    COUNT(*) AS active_days,
    MAX(occurred_at) AS last_seen
  FROM activity_events
  WHERE type = 'auth'
    AND actor_sub IS NOT NULL
    AND actor_sub NOT IN (SELECT actor_sub FROM usage_core_actor_subs)
  GROUP BY actor_sub, surface;
--> statement-breakpoint

CREATE VIEW "usage_auth_by_source_7d" AS
  SELECT
    surface,
    COUNT(*) AS user_days,
    COUNT(DISTINCT actor_sub) AS distinct_users
  FROM activity_events
  WHERE type = 'auth'
    AND occurred_at >= NOW() - INTERVAL '7 days'
    AND actor_sub NOT IN (SELECT actor_sub FROM usage_core_actor_subs)
  GROUP BY surface
  ORDER BY user_days DESC;
--> statement-breakpoint

-- One row per (sub, surface, day) means the daily count IS the distinct-user
-- count for that surface — named accordingly.
CREATE VIEW "usage_auth_by_source_day_7d" AS
  SELECT
    date_trunc('day', occurred_at AT TIME ZONE 'UTC')::date AS day,
    surface,
    COUNT(DISTINCT actor_sub) AS distinct_users
  FROM activity_events
  WHERE type = 'auth'
    AND occurred_at >= NOW() - INTERVAL '7 days'
    AND actor_sub NOT IN (SELECT actor_sub FROM usage_core_actor_subs)
  GROUP BY day, surface
  ORDER BY day DESC, surface;
--> statement-breakpoint

CREATE VIEW "usage_multi_surface_users" AS
  SELECT
    actor_sub,
    array_agg(DISTINCT surface ORDER BY surface) AS surfaces,
    COUNT(DISTINCT surface) AS surface_count,
    COUNT(*) AS active_days_total,
    MAX(occurred_at) AS last_seen
  FROM activity_events
  WHERE type = 'auth'
    AND actor_sub IS NOT NULL
    AND actor_sub NOT IN (SELECT actor_sub FROM usage_core_actor_subs)
  GROUP BY actor_sub
  HAVING COUNT(DISTINCT surface) > 1
  ORDER BY surface_count DESC, active_days_total DESC;
--> statement-breakpoint

-- ----------------------------------------------------------------------------
-- 4b. Schedule views — success/failure renamed to delivery
--
-- The underlying data is correct and unchanged; the labels were not. A
-- schedule fire's outcome records whether the TRIGGER reached the agent's
-- outbox and the wake was poked — never whether the agent did the work.
-- Sessions are agent-owned, so the api-server cannot observe the run at all.
-- `success_count` read as "the schedule worked", which it never meant.
-- ----------------------------------------------------------------------------

DROP VIEW IF EXISTS "usage_schedule_fires_by_schedule";--> statement-breakpoint
DROP VIEW IF EXISTS "usage_schedule_fires_by_agent";--> statement-breakpoint

CREATE VIEW "usage_schedule_fires_by_schedule" AS
  SELECT
    (payload->>'scheduleId') AS schedule_id,
    agent_id,
    COUNT(*) AS fire_count,
    COUNT(*) FILTER (WHERE outcome = 'success') AS delivered_count,
    COUNT(*) FILTER (WHERE outcome = 'failure') AS delivery_failed_count,
    MIN(occurred_at) AS first_fire,
    MAX(occurred_at) AS last_fire
  FROM activity_events
  WHERE type = 'schedule_fire'
    AND agent_id NOT IN (SELECT agent_id FROM usage_core_agents)
  GROUP BY schedule_id, agent_id
  ORDER BY fire_count DESC;
--> statement-breakpoint

CREATE VIEW "usage_schedule_fires_by_agent" AS
  SELECT
    agent_id,
    COUNT(*) AS fire_count,
    COUNT(*) FILTER (WHERE outcome = 'success') AS delivered_count,
    COUNT(*) FILTER (WHERE outcome = 'failure') AS delivery_failed_count,
    COUNT(DISTINCT (payload->>'scheduleId')) AS schedule_count,
    MIN(occurred_at) AS first_fire,
    MAX(occurred_at) AS last_fire
  FROM activity_events
  WHERE type = 'schedule_fire'
    AND agent_id NOT IN (SELECT agent_id FROM usage_core_agents)
  GROUP BY agent_id
  ORDER BY fire_count DESC;
