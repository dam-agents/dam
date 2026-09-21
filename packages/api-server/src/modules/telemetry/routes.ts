import { Hono } from "hono";
import {
  TELEMETRY_EXPORT_MAX_ROWS,
  telemetryExportQuerySchema,
  type UserIdentity,
} from "api-server-api";

import type { ApiVariables } from "../../core/http-context.js";
import type { TelemetryReader } from "./services/telemetry-service.js";
import {
  scopeOwnedAgentIds,
  TELEMETRY_DISABLED_REASON,
} from "./services/telemetry-service.js";

export interface TelemetryRoutesDeps {
  reader: TelemetryReader | null;
  listLiveAgentIds: (rawSub: string) => Promise<string[]>;
  listRegisteredAgentIds: (rawSub: string) => Promise<string[]>;
}

type AppEnv = { Variables: ApiVariables };

async function ownedIds(
  deps: TelemetryRoutesDeps,
  user: UserIdentity,
  agentId: string | undefined,
): Promise<string[]> {
  const [liveIds, registeredIds] = await Promise.all([
    deps.listLiveAgentIds(user.sub),
    deps.listRegisteredAgentIds(user.sub),
  ]);
  return scopeOwnedAgentIds({
    liveIds,
    registeredIds,
    granted: user.agentIds,
    agentId,
  });
}

function ndjson(rows: readonly unknown[]): string {
  return rows.map((row) => JSON.stringify(row)).join("\n") + "\n";
}

export function createTelemetryRoutes(deps: TelemetryRoutesDeps) {
  const routes = new Hono<AppEnv>();

  routes.get("/api/telemetry/export", async (c) => {
    const reader = deps.reader;
    if (!reader) {
      return c.json({ error: TELEMETRY_DISABLED_REASON }, 412);
    }
    const parsed = telemetryExportQuerySchema.safeParse({
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

    const stampFor = new Date().toISOString().slice(0, 10);
    const scopeFor = query.agentId ?? "all-agents";
    const withHeaders = (truncated: boolean) => {
      c.header("content-type", "application/x-ndjson; charset=utf-8");
      c.header(
        "content-disposition",
        `attachment; filename="telemetry-${scopeFor}-${query.signal}-${stampFor}.ndjson"`,
      );
      if (truncated) c.header("x-platform-truncated", "true");
    };

    if (ids.length === 0) {
      withHeaders(false);
      return c.body(ndjson([]));
    }

    const window = {
      hours: query.sinceHours,
      ...(query.sessionId === undefined ? {} : { sessionId: query.sessionId }),
    };

    let rows: readonly unknown[];
    try {
      rows =
        query.signal === "logs"
          ? await reader.logRecords(ids, window, TELEMETRY_EXPORT_MAX_ROWS)
          : await exportSpans(reader, ids, window);
    } catch (err) {
      return c.json({ error: storeFailureMessage(err) }, 502);
    }

    withHeaders(rows.length >= TELEMETRY_EXPORT_MAX_ROWS);
    return c.body(ndjson(rows));
  });

  return routes;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: the store can be reachable and still unable to
 * answer — most often because its tables have not been created, which is what a
 * collector that started before the store looks like from here. Saying so beats
 * an unexplained failure, since the fix is operational rather than a retry.
 */
function storeFailureMessage(err: unknown): string {
  const detail = err instanceof Error ? err.message : String(err);
  if (detail.includes("Unknown table expression")) {
    return "The telemetry store has no tables yet, so there is nothing to export. Its collector creates them when it starts, and has not done so against this store.";
  }
  return `The telemetry store could not answer the export: ${detail}`;
}

async function exportSpans(
  reader: TelemetryReader,
  ids: readonly string[],
  window: { hours: number; sessionId?: string },
): Promise<unknown[]> {
  if (ids.length === 0) return [];
  return reader.sessionSpans(ids, window, TELEMETRY_EXPORT_MAX_ROWS);
}
