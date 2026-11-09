import { lt, sql, uiEvents, type Db } from "db";
import type { UiEvent, UiFlow, UiFlowStep, UiSignal } from "api-server-api";
import type { SubPseudonymizer } from "../../../core/sub-pseudonymizer.js";
import {
  UI_MIN_USERS,
  UI_TRAIL_LIMIT,
  previousPeriod,
  type UiPeriod,
  type UiSignalsFacts,
  type UiTrailStep,
} from "../domain/ui-signals-report.js";

export interface UiEventsBatch {
  actorSub: string;
  tab: string;
  build: string;
  receivedAt: Date;
  events: UiEvent[];
}

function detailOf(e: UiEvent) {
  switch (e.kind) {
    case "view":
      return { durationMs: e.dwellMs };
    case "action":
      return { element: e.element };
    case "signal":
      return {
        element: e.element,
        signal: e.signal,
        durationMs: e.durationMs ?? null,
      };
    case "flow_step":
      return { flow: e.flow, step: e.step };
  }
}

export function insertUiEvents(db: Db, pseudo: SubPseudonymizer) {
  return async (batch: UiEventsBatch): Promise<void> => {
    const actorSub = pseudo.hashSub(batch.actorSub);
    await db.insert(uiEvents).values(
      batch.events.map((e) => ({
        actorSub,
        tab: batch.tab,
        build: batch.build,
        seq: e.seq,
        kind: e.kind,
        route: e.route,
        occurredAt: new Date(batch.receivedAt.getTime() - e.ageMs),
        ...detailOf(e),
      })),
    );
  };
}

export function deleteUiEventsOlderThan(db: Db) {
  return async (days: number): Promise<number> => {
    const result = await db
      .delete(uiEvents)
      .where(
        lt(uiEvents.occurredAt, sql`now() - make_interval(days => ${days})`),
      );
    return (result as unknown as { rowCount?: number }).rowCount ?? 0;
  };
}

const n = (v: number | string | null) => Number(v ?? 0);

export function readUiSignalsFacts(db: Db) {
  return async ({ from, to }: UiPeriod): Promise<UiSignalsFacts> => {
    const fromTs = sql`${from.toISOString()}::timestamptz`;
    const toTs = sql`${to.toISOString()}::timestamptz`;
    const prevFrom = sql`${previousPeriod({ from, to }).from.toISOString()}::timestamptz`;
    const inPeriod = sql`occurred_at >= ${fromTs} AND occurred_at < ${toTs}`;

    const [builds, features, friction, flowSteps, trails] = await Promise.all([
      db.execute<{ version: string; first_seen: Date; users: string }>(sql`
        SELECT b.build AS version, f.first_seen, count(DISTINCT b.actor_sub) AS users
        FROM usage_ui_events b
        JOIN (SELECT build, min(occurred_at) AS first_seen FROM usage_ui_events GROUP BY build) f
          USING (build)
        WHERE ${inPeriod}
        GROUP BY b.build, f.first_seen
        HAVING count(DISTINCT b.actor_sub) >= ${UI_MIN_USERS}`),
      db.execute<{
        route: string;
        element: string | null;
        users: string;
        uses: string;
      }>(sql`
        SELECT route, element, count(DISTINCT actor_sub) AS users, count(*) AS uses
        FROM usage_ui_events
        WHERE kind IN ('view', 'action') AND ${inPeriod}
        GROUP BY route, element
        HAVING count(DISTINCT actor_sub) >= ${UI_MIN_USERS}`),
      db.execute<{
        signal: UiSignal;
        route: string;
        element: string | null;
        build: string;
        users: string;
        events: string;
        prev_events: string;
        views: string | null;
        prev_views: string | null;
      }>(sql`
        WITH sig AS (
          SELECT id, signal, route, element, build, actor_sub, occurred_at,
            occurred_at >= ${fromTs} AS current
          FROM usage_ui_events
          WHERE kind = 'signal' AND occurred_at >= ${prevFrom} AND occurred_at < ${toTs}
        ),
        views AS (
          SELECT route,
            count(*) FILTER (WHERE occurred_at >= ${fromTs}) AS views,
            count(*) FILTER (WHERE occurred_at < ${fromTs}) AS prev_views
          FROM usage_ui_events
          WHERE kind = 'view' AND occurred_at >= ${prevFrom} AND occurred_at < ${toTs}
          GROUP BY route
        )
        SELECT s.signal, s.route, s.element,
          (array_agg(s.build ORDER BY s.occurred_at DESC, s.id DESC) FILTER (WHERE s.current))[1] AS build,
          count(DISTINCT s.actor_sub) FILTER (WHERE s.current) AS users,
          count(*) FILTER (WHERE s.current) AS events,
          count(*) FILTER (WHERE NOT s.current) AS prev_events,
          v.views, v.prev_views
        FROM sig s
        LEFT JOIN views v USING (route)
        GROUP BY s.signal, s.route, s.element, v.views, v.prev_views
        HAVING count(DISTINCT s.actor_sub) FILTER (WHERE s.current) >= ${UI_MIN_USERS}`),
      db.execute<{
        flow: UiFlow;
        step: UiFlowStep;
        users: string;
        median_ms: number;
      }>(sql`
        SELECT flow, step, count(DISTINCT actor_sub) AS users,
          percentile_cont(0.5) WITHIN GROUP (ORDER BY ms_from_start) AS median_ms
        FROM usage_ui_flow_steps
        WHERE started_at >= ${fromTs} AND started_at < ${toTs}
        GROUP BY flow, step
        HAVING count(DISTINCT actor_sub) >= ${UI_MIN_USERS}`),
      db.execute<{
        id: string;
        signal: UiSignal;
        route: string;
        element: string | null;
        build: string;
        users: string;
        steps: UiTrailStep[];
      }>(sql`
        WITH t AS (
          SELECT * FROM usage_ui_signal_trails WHERE ${inPeriod}
        ),
        kept AS (
          SELECT trail_key,
            count(DISTINCT actor_sub) AS users,
            (array_agg(build ORDER BY occurred_at DESC, id DESC))[1] AS build,
            (array_agg(id ORDER BY occurred_at DESC, id DESC))[1] AS sample_id
          FROM t
          GROUP BY trail_key
          HAVING count(DISTINCT actor_sub) >= ${UI_MIN_USERS}
          ORDER BY users DESC
          LIMIT ${UI_TRAIL_LIMIT}
        ),
        timings AS (
          SELECT t.trail_key, s.ord,
            percentile_cont(0.5) WITHIN GROUP (ORDER BY (s.step ->> 'dtMs')::bigint) AS dt_ms
          FROM t
          JOIN kept USING (trail_key)
          CROSS JOIN LATERAL jsonb_array_elements(t.steps) WITH ORDINALITY AS s(step, ord)
          GROUP BY t.trail_key, s.ord
        )
        SELECT kept.trail_key AS id, sample.signal, sample.route, sample.element,
          kept.build, kept.users,
          coalesce((
            SELECT jsonb_agg(
              jsonb_build_object(
                'kind', s.step ->> 'kind',
                'route', s.step ->> 'route',
                'element', s.step -> 'element',
                'dtMs', round(timings.dt_ms)
              ) ORDER BY s.ord)
            FROM jsonb_array_elements(sample.steps) WITH ORDINALITY AS s(step, ord)
            JOIN timings ON timings.trail_key = kept.trail_key AND timings.ord = s.ord
          ), '[]'::jsonb) AS steps
        FROM kept
        JOIN t AS sample ON sample.id = kept.sample_id`),
    ]);

    return {
      builds: builds.map((r) => ({
        version: r.version,
        firstSeen: new Date(r.first_seen),
        users: n(r.users),
      })),
      features: features.map((r) => ({
        route: r.route,
        element: r.element,
        users: n(r.users),
        uses: n(r.uses),
      })),
      friction: friction.map((r) => ({
        signal: r.signal,
        route: r.route,
        element: r.element,
        build: r.build,
        users: n(r.users),
        events: n(r.events),
        views: n(r.views),
        prevEvents: n(r.prev_events),
        prevViews: n(r.prev_views),
      })),
      flowSteps: flowSteps.map((r) => ({
        flow: r.flow,
        step: r.step,
        users: n(r.users),
        medianMsFromStart: Math.round(Number(r.median_ms)),
      })),
      trails: trails.map((r) => ({
        id: r.id,
        signal: r.signal,
        route: r.route,
        element: r.element,
        build: r.build,
        users: n(r.users),
        steps: r.steps,
      })),
    };
  };
}
