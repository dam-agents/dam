import { Hono } from "hono";
import {
  TIMELINE_EXPORT_MAX_ROWS,
  timelineExportQuerySchema,
  type UserIdentity,
} from "api-server-api";

import type { ApiVariables } from "../../core/http-context.js";
import type { TimelineReader } from "./services/timeline-service.js";
import { TIMELINE_DISABLED_REASON } from "./services/timeline-service.js";

export interface TimelineRoutesDeps {
  reader: TimelineReader | null;
  listRegisteredAgentIds: (rawSub: string) => Promise<string[]>;
}

type AppEnv = { Variables: ApiVariables };

async function ownedIds(
  deps: TimelineRoutesDeps,
  user: UserIdentity,
  agentId: string | undefined,
): Promise<string[]> {
  const registered = await deps.listRegisteredAgentIds(user.sub);
  const scoped =
    user.agentIds === "*"
      ? registered
      : registered.filter((id) => user.agentIds.includes(id));
  if (!agentId) return scoped;
  return scoped.includes(agentId) ? [agentId] : [];
}

function ndjson(rows: readonly unknown[]): string {
  return rows.map((row) => JSON.stringify(row)).join("\n") + "\n";
}

export function createTimelineRoutes(deps: TimelineRoutesDeps) {
  const routes = new Hono<AppEnv>();

  routes.get("/api/timeline/export", async (c) => {
    const reader = deps.reader;
    if (!reader) {
      return c.json({ error: TIMELINE_DISABLED_REASON }, 412);
    }
    const parsed = timelineExportQuerySchema.safeParse({
      ...(c.req.query("agentId") === undefined
        ? {}
        : { agentId: c.req.query("agentId") }),
      ...(c.req.query("sessionId") === undefined
        ? {}
        : { sessionId: c.req.query("sessionId") }),
      ...(c.req.query("signal") === undefined
        ? {}
        : { signal: c.req.query("signal") }),
      ...(c.req.query("sinceHours") === undefined
        ? {}
        : { sinceHours: c.req.query("sinceHours") }),
    });
    if (!parsed.success) {
      return c.json({ error: "invalid export query" }, 400);
    }
    const query = parsed.data;
    const ids = await ownedIds(deps, c.get("user"), query.agentId);

    const window = {
      hours: query.sinceHours,
      ...(query.sessionId === undefined ? {} : { sessionId: query.sessionId }),
    };

    const rows =
      query.signal === "logs"
        ? await reader.logRecords(ids, window, TIMELINE_EXPORT_MAX_ROWS)
        : await exportSpans(reader, ids, window);

    const stamp = new Date().toISOString().slice(0, 10);
    const scope = query.agentId ?? "all-agents";
    c.header("content-type", "application/x-ndjson; charset=utf-8");
    c.header(
      "content-disposition",
      `attachment; filename="timeline-${scope}-${query.signal}-${stamp}.ndjson"`,
    );
    if (rows.length >= TIMELINE_EXPORT_MAX_ROWS) {
      c.header("x-platform-truncated", "true");
    }
    return c.body(ndjson(rows));
  });

  return routes;
}

async function exportSpans(
  reader: TimelineReader,
  ids: readonly string[],
  window: { hours: number; sessionId?: string },
): Promise<unknown[]> {
  if (ids.length === 0) return [];
  return reader.sessionSpans(ids, window, TIMELINE_EXPORT_MAX_ROWS);
}
