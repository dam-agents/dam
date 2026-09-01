-- Windowed usage views counted back from NOW() rather than from a day
-- boundary, so every window both opened and closed mid-day.
--
-- The cut-off and the reported day were anchored to different things: the
-- filter was `occurred_at >= NOW() - INTERVAL '7 days'`, while the day column
-- is `date_trunc('day', occurred_at AT TIME ZONE 'UTC')`. What followed was
-- clock-dependent in four ways:
--
--   * The per-day views returned EIGHT rows, not seven. Read on a Monday at
--     09:00 UTC the window opened the previous Monday at 09:00, so that Monday
--     held only 09:00-24:00, today held only 00:00-09:00, and the six days
--     between were whole. The two edge rows undercounted against the middle
--     ones — the one comparison a per-day view exists to support.
--   * `usage_auth_users_7d.active_days` counts distinct UTC days across that
--     span, so a user could report 8 active days in a 7-day view.
--   * Nothing was reproducible: the same view read twice in a day returned
--     different numbers, and a past week's report could not be re-derived.
--   * Auth rows are collapsed to one per (sub, surface, UTC day) by a partial
--     unique index, and the row that survives is the FIRST login of that day.
--     On the oldest day the cut-off therefore admitted only users whose first
--     login fell later in the day than the current wall clock — an arbitrary
--     slice of that day's users, biased against the early ones.
--
-- Each window now spans whole UTC days and ends at today's UTC midnight: the
-- seven (or thirty) complete days BEFORE today, with today excluded. Read on a
-- Monday morning, a 7-day view covers Monday through Sunday. Today is left out
-- because a partial day plotted beside whole ones reads as a drop in usage
-- rather than as a day still in progress. The cost is that the newest day takes
-- up to 24 hours to appear; for an operator-facing weekly report that is the
-- cheaper loss, and the unbounded views (`usage_auth_surface_by_user`,
-- `usage_channel_turns_by_agent`, and the rest) still show today's traffic.
--
-- The boundary is spelled `date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME
-- ZONE 'UTC'` rather than `CURRENT_DATE` so that it pins to UTC midnight
-- whatever TimeZone the reading session carries, matching the UTC day these
-- views bucket by. `CURRENT_DATE` would drift with the session and silently
-- disagree with the `day` column beside it.
--
-- Views are REPLACED rather than dropped and recreated: only the WHERE clause
-- changes, so every column name, type and position is identical and CREATE OR
-- REPLACE VIEW is legal here — which also preserves any grant held on them.

-- ----------------------------------------------------------------------------
-- 7-day windows — the previous seven complete UTC days
-- ----------------------------------------------------------------------------

CREATE OR REPLACE VIEW "usage_auth_users_7d" AS
  SELECT
    actor_sub,
    MIN(occurred_at) AS first_seen,
    MAX(occurred_at) AS last_seen,
    COUNT(DISTINCT date_trunc('day', occurred_at AT TIME ZONE 'UTC')) AS active_days
  FROM activity_events
  WHERE type = 'auth'
    AND occurred_at >= (date_trunc('day', now() AT TIME ZONE 'UTC') - INTERVAL '7 days') AT TIME ZONE 'UTC'
    AND occurred_at < date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'
    AND actor_sub IS NOT NULL
    AND actor_sub NOT IN (SELECT actor_sub FROM usage_core_actor_subs)
  GROUP BY actor_sub;
--> statement-breakpoint

CREATE OR REPLACE VIEW "usage_auth_by_source_7d" AS
  SELECT
    surface,
    COUNT(*) AS user_days,
    COUNT(DISTINCT actor_sub) AS distinct_users
  FROM activity_events
  WHERE type = 'auth'
    AND occurred_at >= (date_trunc('day', now() AT TIME ZONE 'UTC') - INTERVAL '7 days') AT TIME ZONE 'UTC'
    AND occurred_at < date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'
    AND actor_sub NOT IN (SELECT actor_sub FROM usage_core_actor_subs)
  GROUP BY surface
  ORDER BY user_days DESC;
--> statement-breakpoint

CREATE OR REPLACE VIEW "usage_auth_by_source_day_7d" AS
  SELECT
    date_trunc('day', occurred_at AT TIME ZONE 'UTC')::date AS day,
    surface,
    COUNT(DISTINCT actor_sub) AS distinct_users
  FROM activity_events
  WHERE type = 'auth'
    AND occurred_at >= (date_trunc('day', now() AT TIME ZONE 'UTC') - INTERVAL '7 days') AT TIME ZONE 'UTC'
    AND occurred_at < date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'
    AND actor_sub NOT IN (SELECT actor_sub FROM usage_core_actor_subs)
  GROUP BY day, surface
  ORDER BY day DESC, surface;
--> statement-breakpoint

CREATE OR REPLACE VIEW "usage_distinct_users_per_day_7d" AS
  SELECT
    date_trunc('day', occurred_at AT TIME ZONE 'UTC')::date AS day,
    COUNT(DISTINCT actor_sub) AS distinct_users
  FROM activity_events
  WHERE type = 'auth'
    AND occurred_at >= (date_trunc('day', now() AT TIME ZONE 'UTC') - INTERVAL '7 days') AT TIME ZONE 'UTC'
    AND occurred_at < date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'
    AND actor_sub IS NOT NULL
    AND actor_sub NOT IN (SELECT actor_sub FROM usage_core_actor_subs)
  GROUP BY day
  ORDER BY day DESC;
--> statement-breakpoint

CREATE OR REPLACE VIEW "usage_channel_turns_by_day_7d" AS
  SELECT
    date_trunc('day', occurred_at AT TIME ZONE 'UTC')::date AS day,
    surface AS channel,
    COUNT(*) AS turn_count,
    COUNT(*) FILTER (WHERE outcome = 'success') AS success_count,
    COUNT(*) FILTER (WHERE outcome = 'failure') AS failure_count
  FROM activity_events
  WHERE type = 'channel_turn'
    AND occurred_at >= (date_trunc('day', now() AT TIME ZONE 'UTC') - INTERVAL '7 days') AT TIME ZONE 'UTC'
    AND occurred_at < date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'
    AND agent_id NOT IN (SELECT agent_id FROM usage_core_agents)
  GROUP BY day, surface
  ORDER BY day DESC, channel;
--> statement-breakpoint

CREATE OR REPLACE VIEW "usage_imports_by_day_7d" AS
  SELECT
    date_trunc('day', occurred_at AT TIME ZONE 'UTC')::date AS day,
    COUNT(*) AS import_count,
    COUNT(*) FILTER (WHERE outcome = 'success') AS success_count,
    COUNT(*) FILTER (WHERE outcome = 'failure') AS failure_count
  FROM activity_events
  WHERE type = 'files_imported'
    AND occurred_at >= (date_trunc('day', now() AT TIME ZONE 'UTC') - INTERVAL '7 days') AT TIME ZONE 'UTC'
    AND occurred_at < date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'
    AND agent_id NOT IN (SELECT agent_id FROM usage_core_agents)
  GROUP BY day
  ORDER BY day DESC;
--> statement-breakpoint

-- ----------------------------------------------------------------------------
-- 30-day windows — the previous thirty complete UTC days
--
-- These carry no day column, so a mid-day cut-off misaligned no rows against
-- each other. They are corrected for the other two reasons: the numbers were
-- irreproducible, and a window meaning one thing in the 7-day views and another
-- in the 30-day ones is a trap for whoever reads both in the same report.
-- ----------------------------------------------------------------------------

CREATE OR REPLACE VIEW "usage_channel_top_agents_30d" AS
  SELECT
    agent_id,
    surface AS channel,
    COUNT(*) AS turn_count,
    COUNT(*) FILTER (WHERE outcome = 'success') AS success_count,
    COUNT(*) FILTER (WHERE outcome = 'failure') AS failure_count,
    MAX(occurred_at) AS last_turn
  FROM activity_events
  WHERE type = 'channel_turn'
    AND occurred_at >= (date_trunc('day', now() AT TIME ZONE 'UTC') - INTERVAL '30 days') AT TIME ZONE 'UTC'
    AND occurred_at < date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'
    AND agent_id IS NOT NULL
    AND agent_id NOT IN (SELECT agent_id FROM usage_core_agents)
  GROUP BY agent_id, surface
  ORDER BY turn_count DESC;
--> statement-breakpoint

CREATE OR REPLACE VIEW "usage_approvals_summary_30d" AS
  SELECT
    type,
    status,
    COALESCE(verdict, '-') AS verdict,
    COUNT(*) AS approval_count
  FROM pending_approvals
  WHERE created_at >= (date_trunc('day', now() AT TIME ZONE 'UTC') - INTERVAL '30 days') AT TIME ZONE 'UTC'
    AND created_at < date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'
    AND agent_id NOT IN (SELECT agent_id FROM usage_core_agents)
  GROUP BY type, status, verdict
  ORDER BY approval_count DESC;
--> statement-breakpoint

CREATE OR REPLACE VIEW "usage_entry_point_choices_30d" AS
  SELECT
    payload ->> 'choice' AS choice,
    COUNT(*) AS choice_count,
    COUNT(DISTINCT actor_sub) AS user_count
  FROM activity_events
  WHERE type = 'entry_point_chosen'
    AND occurred_at >= (date_trunc('day', now() AT TIME ZONE 'UTC') - INTERVAL '30 days') AT TIME ZONE 'UTC'
    AND occurred_at < date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'
    AND actor_sub IS NOT NULL
    AND actor_sub NOT IN (SELECT actor_sub FROM usage_core_actor_subs)
  GROUP BY payload ->> 'choice'
  ORDER BY choice_count DESC;
