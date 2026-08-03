-- Usage reporting views (ADR-048). Hand-written, not generated: they aren't in
-- schema.ts (expressing 23 aggregate views in the ORM is lossy, and drizzle-kit
-- emits interdependent views in the wrong order), so they get their own
-- migration (issue #739, ADR-063) — keeping the 0000 baseline purely generated.
--
-- Existing deployments skip this file: its journal `when` predates every
-- migration they have recorded. Only fresh installs run it, after the baseline's
-- tables. Views are in dependency order — the usage_core_* helpers come first.

-- Every pilot view excludes core-team activity:
--
--   * activity_events-backed views:  AND actor_sub NOT IN (SELECT actor_sub FROM usage_core_actor_subs)
--   * sessions / agent_skills:       AND agent_id NOT IN (SELECT agent_id FROM usage_core_agents)
--   * pending_approvals:             AND owner_sub NOT IN (SELECT actor_sub FROM usage_core_actor_subs)
--   * egress_rules:                  no filter yet — needs agent-ownership capture (out of scope)
--
-- "is this sub core?" is sourced from the actor_roles table, upserted by the
-- persist-activity saga on every UserAuthenticated event from JWT
-- realm_access.roles. Agent ownership is resolved via the `agents` table,
-- populated by the persist-agents saga on `AgentCreated`/`AgentDeleted` plus
-- a startup bootstrap that backfills agents pre-dating the saga.

-- ----------------------------------------------------------------------------
-- Helper views — referenced by core-team filters in the views below
-- ----------------------------------------------------------------------------

-- Keycloak subs currently flagged with the core role (latest seen on auth).
CREATE VIEW "usage_core_actor_subs" AS
  SELECT actor_sub
  FROM actor_roles
  WHERE is_core = true;
--> statement-breakpoint
-- Agents owned by anyone with the core role. Used to exclude core-team
-- agent activity from pilot metrics. Owners with no auth events yet won't
-- appear here — see the edge-case discussion in usage-tracking-steps.md.
CREATE VIEW "usage_core_agents" AS
  SELECT DISTINCT a.id AS agent_id
  FROM agents a
  JOIN usage_core_actor_subs cs ON cs.actor_sub = a.owner_sub;
--> statement-breakpoint

-- ----------------------------------------------------------------------------
-- Auth views (from activity_events, type='auth')
-- ----------------------------------------------------------------------------

CREATE VIEW "usage_auth_users_7d" AS
  SELECT
    actor_sub,
    MIN(occurred_at) AS first_seen,
    MAX(occurred_at) AS last_seen,
    COUNT(*) AS auth_events
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
    COUNT(*) AS auth_count,
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
    COUNT(*) AS auth_events
  FROM activity_events
  WHERE type = 'auth'
    AND occurred_at >= NOW() - INTERVAL '7 days'
    AND actor_sub NOT IN (SELECT actor_sub FROM usage_core_actor_subs)
  GROUP BY surface
  ORDER BY auth_events DESC;
--> statement-breakpoint
CREATE VIEW "usage_auth_by_source_day_7d" AS
  SELECT
    date_trunc('day', occurred_at AT TIME ZONE 'UTC')::date AS day,
    surface,
    COUNT(*) AS auth_events
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
    COUNT(*) AS auth_events_total,
    MAX(occurred_at) AS last_seen
  FROM activity_events
  WHERE type = 'auth'
    AND actor_sub IS NOT NULL
    AND actor_sub NOT IN (SELECT actor_sub FROM usage_core_actor_subs)
  GROUP BY actor_sub
  HAVING COUNT(DISTINCT surface) > 1
  ORDER BY surface_count DESC, auth_events_total DESC;
--> statement-breakpoint
CREATE VIEW "usage_distinct_users_per_day_7d" AS
  SELECT
    date_trunc('day', occurred_at AT TIME ZONE 'UTC')::date AS day,
    COUNT(DISTINCT actor_sub) AS distinct_users
  FROM activity_events
  WHERE type = 'auth'
    AND occurred_at >= NOW() - INTERVAL '7 days'
    AND actor_sub IS NOT NULL
    AND actor_sub NOT IN (SELECT actor_sub FROM usage_core_actor_subs)
  GROUP BY day
  ORDER BY day DESC;
--> statement-breakpoint

-- ----------------------------------------------------------------------------
-- Channel views (from activity_events, type='channel_turn')
-- ----------------------------------------------------------------------------

CREATE VIEW "usage_channel_turns_by_agent" AS
  SELECT
    agent_id,
    surface AS channel,
    COUNT(*) AS turn_count,
    COUNT(*) FILTER (WHERE outcome = 'success') AS success_count,
    COUNT(*) FILTER (WHERE outcome = 'failure') AS failure_count,
    MAX(occurred_at) AS last_turn
  FROM activity_events
  WHERE type = 'channel_turn'
    AND agent_id NOT IN (SELECT agent_id FROM usage_core_agents)
  GROUP BY agent_id, surface;
--> statement-breakpoint
CREATE VIEW "usage_channel_turns_by_day_7d" AS
  SELECT
    date_trunc('day', occurred_at AT TIME ZONE 'UTC')::date AS day,
    surface AS channel,
    COUNT(*) AS turn_count,
    COUNT(*) FILTER (WHERE outcome = 'success') AS success_count,
    COUNT(*) FILTER (WHERE outcome = 'failure') AS failure_count
  FROM activity_events
  WHERE type = 'channel_turn'
    AND occurred_at >= NOW() - INTERVAL '7 days'
    AND agent_id NOT IN (SELECT agent_id FROM usage_core_agents)
  GROUP BY day, surface
  ORDER BY day DESC, channel;
--> statement-breakpoint
CREATE VIEW "usage_channel_top_agents_30d" AS
  SELECT
    agent_id,
    surface AS channel,
    COUNT(*) AS turn_count,
    COUNT(*) FILTER (WHERE outcome = 'success') AS success_count,
    COUNT(*) FILTER (WHERE outcome = 'failure') AS failure_count,
    MAX(occurred_at) AS last_turn
  FROM activity_events
  WHERE type = 'channel_turn'
    AND occurred_at >= NOW() - INTERVAL '30 days'
    AND agent_id IS NOT NULL
    AND agent_id NOT IN (SELECT agent_id FROM usage_core_agents)
  GROUP BY agent_id, surface
  ORDER BY turn_count DESC;
--> statement-breakpoint

-- Sourced from activity_events (type='schedule_fire'), not sessions: continuous-mode
-- schedules reuse one sessions row across many fires, so counting sessions
-- under-reports. ScheduleFired events fire once per trigger and carry outcome.
CREATE VIEW "usage_schedule_fires_by_schedule" AS
  SELECT
    (payload->>'scheduleId') AS schedule_id,
    agent_id,
    COUNT(*) AS fire_count,
    COUNT(*) FILTER (WHERE outcome = 'success') AS success_count,
    COUNT(*) FILTER (WHERE outcome = 'failure') AS failure_count,
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
    COUNT(*) FILTER (WHERE outcome = 'success') AS success_count,
    COUNT(*) FILTER (WHERE outcome = 'failure') AS failure_count,
    COUNT(DISTINCT (payload->>'scheduleId')) AS schedule_count,
    MIN(occurred_at) AS first_fire,
    MAX(occurred_at) AS last_fire
  FROM activity_events
  WHERE type = 'schedule_fire'
    AND agent_id NOT IN (SELECT agent_id FROM usage_core_agents)
  GROUP BY agent_id
  ORDER BY fire_count DESC;
--> statement-breakpoint

-- ----------------------------------------------------------------------------
-- Approvals (from pending_approvals)
-- ----------------------------------------------------------------------------

CREATE VIEW "usage_approvals_summary_30d" AS
  SELECT
    type,
    status,
    COALESCE(verdict, '-') AS verdict,
    COUNT(*) AS approval_count
  FROM pending_approvals
  WHERE created_at >= NOW() - INTERVAL '30 days'
    AND owner_sub NOT IN (SELECT actor_sub FROM usage_core_actor_subs)
  GROUP BY type, status, verdict
  ORDER BY approval_count DESC;
--> statement-breakpoint

-- ----------------------------------------------------------------------------
-- Skills (from agent_skills and skill_sources)
-- ----------------------------------------------------------------------------

CREATE VIEW "usage_skill_installs_by_skill" AS
  SELECT
    source,
    name,
    COUNT(DISTINCT agent_id) AS agent_count,
    MIN(installed_at) AS first_install,
    MAX(installed_at) AS last_install
  FROM agent_skills
  WHERE agent_id NOT IN (SELECT agent_id FROM usage_core_agents)
  GROUP BY source, name
  ORDER BY agent_count DESC;
--> statement-breakpoint
-- "by_user" = grouped by the skill_sources.owner (the person who curated the
-- source). Per-installer attribution would require joining to agents.owner_sub.
CREATE VIEW "usage_skill_installs_by_user" AS
  SELECT
    ss.owner,
    COUNT(*) AS install_count,
    COUNT(DISTINCT as_.name) AS distinct_skills
  FROM agent_skills as_
  JOIN skill_sources ss ON ss.git_url = as_.source
  WHERE as_.agent_id NOT IN (SELECT agent_id FROM usage_core_agents)
  GROUP BY ss.owner
  ORDER BY install_count DESC;
--> statement-breakpoint

-- ----------------------------------------------------------------------------
-- Egress (from egress_rules) — post-ADR-046 egress_rules.agent_id keys on
-- the agent (formerly the template, but instance and template are collapsed
-- now). Core-team filter could join through `agents.owner_sub` but the
-- existing views don't yet. Left as-is for now.
-- ----------------------------------------------------------------------------

CREATE VIEW "usage_egress_hosts_by_agent" AS
  SELECT
    agent_id,
    COUNT(DISTINCT host) AS distinct_hosts,
    COUNT(*) FILTER (WHERE status = 'active') AS active_rules,
    COUNT(*) FILTER (WHERE verdict = 'allow') AS allow_rules,
    COUNT(*) FILTER (WHERE verdict = 'deny') AS deny_rules
  FROM egress_rules
  GROUP BY agent_id
  ORDER BY distinct_hosts DESC;
--> statement-breakpoint

-- ----------------------------------------------------------------------------
-- Connection views (from activity_events, type='connection_added' / 'connection_removed')
--
-- Persist-activity writes one row per OAuth grant or revoke. Re-grants
-- (token expired, user reconnected) appear as additional rows for the same
-- (actor_sub, payload->>'connectionKey') — the views collapse that with
-- DISTINCT so cardinality reflects users/connections, not grants over time.
-- ----------------------------------------------------------------------------

CREATE VIEW "usage_connections_by_user" AS
  SELECT
    actor_sub,
    array_agg(DISTINCT payload->>'connectionKey' ORDER BY payload->>'connectionKey') AS connection_keys,
    COUNT(DISTINCT payload->>'connectionKey') AS distinct_connection_count,
    MIN(occurred_at) AS first_connected,
    MAX(occurred_at) AS last_connected
  FROM activity_events
  WHERE type = 'connection_added'
    AND actor_sub IS NOT NULL
    AND actor_sub NOT IN (SELECT actor_sub FROM usage_core_actor_subs)
  GROUP BY actor_sub
  ORDER BY distinct_connection_count DESC;
--> statement-breakpoint
CREATE VIEW "usage_connections_by_key" AS
  SELECT
    payload->>'connectionKey' AS connection_key,
    surface AS kind,
    COUNT(DISTINCT actor_sub) AS distinct_users,
    COUNT(*) AS grant_count,
    MAX(occurred_at) AS last_connected
  FROM activity_events
  WHERE type = 'connection_added'
    AND actor_sub IS NOT NULL
    AND actor_sub NOT IN (SELECT actor_sub FROM usage_core_actor_subs)
  GROUP BY connection_key, kind
  ORDER BY distinct_users DESC;
--> statement-breakpoint
CREATE VIEW "usage_connection_churn_by_user" AS
  SELECT
    actor_sub,
    COUNT(*) FILTER (WHERE type = 'connection_added') AS adds,
    COUNT(*) FILTER (WHERE type = 'connection_removed') AS removes,
    COUNT(DISTINCT payload->>'connectionKey') FILTER (WHERE type = 'connection_added') AS distinct_added,
    COUNT(DISTINCT payload->>'connectionKey') FILTER (WHERE type = 'connection_removed') AS distinct_removed
  FROM activity_events
  WHERE type IN ('connection_added', 'connection_removed')
    AND actor_sub IS NOT NULL
    AND actor_sub NOT IN (SELECT actor_sub FROM usage_core_actor_subs)
  GROUP BY actor_sub
  ORDER BY adds DESC;
--> statement-breakpoint

-- ----------------------------------------------------------------------------
-- File-import views (from activity_events, type='files_imported')
-- ----------------------------------------------------------------------------

CREATE VIEW "usage_imports_by_agent" AS
  SELECT
    agent_id,
    COUNT(*) AS import_count,
    COUNT(*) FILTER (WHERE outcome = 'success') AS success_count,
    COUNT(*) FILTER (WHERE outcome = 'failure') AS failure_count,
    SUM((payload->>'bytes')::bigint) FILTER (WHERE outcome = 'success') AS bytes_total,
    MAX(occurred_at) AS last_import
  FROM activity_events
  WHERE type = 'files_imported'
    AND agent_id NOT IN (SELECT agent_id FROM usage_core_agents)
  GROUP BY agent_id
  ORDER BY import_count DESC;
--> statement-breakpoint
CREATE VIEW "usage_imports_by_user" AS
  SELECT
    actor_sub,
    COUNT(*) AS import_count,
    COUNT(*) FILTER (WHERE outcome = 'success') AS success_count,
    COUNT(*) FILTER (WHERE outcome = 'failure') AS failure_count,
    MIN(occurred_at) AS first_import,
    MAX(occurred_at) AS last_import
  FROM activity_events
  WHERE type = 'files_imported'
    AND actor_sub IS NOT NULL
    AND actor_sub NOT IN (SELECT actor_sub FROM usage_core_actor_subs)
  GROUP BY actor_sub
  ORDER BY import_count DESC;
--> statement-breakpoint
CREATE VIEW "usage_imports_by_day_7d" AS
  SELECT
    date_trunc('day', occurred_at AT TIME ZONE 'UTC')::date AS day,
    COUNT(*) AS import_count,
    COUNT(*) FILTER (WHERE outcome = 'success') AS success_count,
    COUNT(*) FILTER (WHERE outcome = 'failure') AS failure_count
  FROM activity_events
  WHERE type = 'files_imported'
    AND occurred_at >= NOW() - INTERVAL '7 days'
    AND agent_id NOT IN (SELECT agent_id FROM usage_core_agents)
  GROUP BY day
  ORDER BY day DESC;
