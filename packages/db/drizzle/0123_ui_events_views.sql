-- Read views over ui_events. Core-team traffic is left out, as in every pilot
-- view. Windows, k-anonymity (at least 3 distinct users per row) and the
-- previous-period comparison are applied by the api-server on top of these,
-- since a view cannot take the period as a parameter.

CREATE VIEW "usage_ui_events" AS
  SELECT id, actor_sub, tab, build, seq, kind, route, element, signal, flow,
    step, duration_ms, occurred_at
  FROM ui_events
  WHERE actor_sub NOT IN (SELECT actor_sub FROM usage_core_actor_subs);
--> statement-breakpoint
-- One row per friction signal with the last 10 views and clicks before it in
-- the same browser tab. dtMs is how long before the signal the step happened.
-- trail_key hashes the signal, its place and the step sequence (not the
-- timings), so the same path from different users groups into one trail.
-- Route and element never contain '|' or '>', so the hashed text is unambiguous.
CREATE VIEW "usage_ui_signal_trails" AS
  SELECT
    s.id,
    s.actor_sub,
    s.build,
    s.signal,
    s.route,
    s.element,
    s.occurred_at,
    t.steps,
    md5(concat_ws('|', s.signal, s.route, coalesce(s.element, ''), t.shape)) AS trail_key
  FROM usage_ui_events s
  CROSS JOIN LATERAL (
    SELECT
      coalesce(
        jsonb_agg(
          jsonb_build_object(
            'kind', p.kind,
            'route', p.route,
            'element', p.element,
            'dtMs', GREATEST(0, (EXTRACT(EPOCH FROM (s.occurred_at - p.occurred_at)) * 1000)::bigint)
          ) ORDER BY p.seq
        ),
        '[]'::jsonb
      ) AS steps,
      coalesce(
        string_agg(concat_ws('>', p.kind, p.route, coalesce(p.element, '')), '|' ORDER BY p.seq),
        ''
      ) AS shape
    FROM (
      SELECT e.kind, e.route, e.element, e.seq, e.occurred_at
      FROM ui_events e
      WHERE e.tab = s.tab
        AND e.actor_sub = s.actor_sub
        AND e.seq < s.seq
        AND e.kind IN ('view', 'action')
      ORDER BY e.seq DESC
      LIMIT 10
    ) p
  ) t
  WHERE s.kind = 'signal';
--> statement-breakpoint
-- One row per journey step a tab reached, first time only. A journey starts at
-- the first step of that flow the tab reported.
CREATE VIEW "usage_ui_flow_steps" AS
  WITH firsts AS (
    SELECT actor_sub, tab, flow, step, min(occurred_at) AS reached_at
    FROM usage_ui_events
    WHERE kind = 'flow_step'
    GROUP BY actor_sub, tab, flow, step
  ),
  started AS (
    SELECT f.*, min(f.reached_at) OVER (PARTITION BY f.tab, f.flow) AS started_at
    FROM firsts f
  )
  SELECT actor_sub, tab, flow, step, reached_at, started_at,
    (EXTRACT(EPOCH FROM (reached_at - started_at)) * 1000)::bigint AS ms_from_start
  FROM started;
