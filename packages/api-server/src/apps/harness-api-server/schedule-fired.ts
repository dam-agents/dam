import type { Hono } from "hono";
import type { Db } from "db";
import { resolveAgent } from "./agent-auth.js";
import type { K8sClient } from "../../modules/agents/infrastructure/k8s.js";
import type { RuntimeMutator } from "../../modules/runtime-delivery/index.js";

/**
 * Schedule-fired hook called by the controller's scheduler (ADR-053). Replaces
 * the legacy `kubectl exec`-into-`~/.triggers/` mechanism (ADR-008).
 *
 * The endpoint is the bridge during the controller migration: the controller's
 * Go cron continues to compute firings but POSTs here instead of exec-ing the
 * pod. This handler inserts a `runtime_events` row of kind=`trigger` and
 * enqueues the runtime-channel delivery. The agent's event loop ultimately
 * calls `runtime.v1.events.trigger` which is idempotent on event id.
 *
 * Eventually the scheduler proper moves into api-server (per ADR-053); this
 * endpoint will retire then.
 */
export interface ScheduleFiredDeps {
  db: Db;
  k8s: K8sClient;
  runtimeMutator: RuntimeMutator;
}

interface ScheduleFiredBody {
  scheduleId: string;
  task: string;
  sessionMode?: "continuous" | "fresh";
  mcpServers?: unknown[];
  // Event TTL — when this firing should be considered dropped if not yet
  // delivered. Defaults to 1h.
  ttlSeconds?: number;
}

export function mountScheduleFiredRoute(
  app: Hono,
  deps: ScheduleFiredDeps,
): void {
  app.post("/api/agents/:id/internal/schedule-fired", async (c) => {
    const agentId = c.req.param("id")!;
    const verified = await resolveAgent(deps.k8s, agentId);
    if (!verified) {
      return c.json({ error: "not found" }, 404);
    }

    let body: ScheduleFiredBody;
    try {
      body = await c.req.json<ScheduleFiredBody>();
    } catch {
      return c.json({ error: "invalid json" }, 400);
    }
    if (!body.scheduleId || !body.task) {
      return c.json({ error: "scheduleId, task required" }, 400);
    }

    const ttlSec = body.ttlSeconds ?? 3600;
    const expiresAt = new Date(Date.now() + ttlSec * 1000);
    // Event id ties this firing to a stable identity across redeliveries
    // and across replicas. Per-firing UUID would also work; <scheduleId>:
    // <millis> is shorter and human-readable, and serves the dedupe key.
    const eventId = `${body.scheduleId}:${Date.now()}`;

    try {
      await deps.db.transaction(async (tx) => {
        await deps.runtimeMutator.commitInTx(tx as unknown as Db, agentId, [
          {
            id: eventId,
            kind: "trigger",
            payload: {
              scheduleId: body.scheduleId,
              task: body.task,
              ...(body.sessionMode ? { sessionMode: body.sessionMode } : {}),
              ...(body.mcpServers ? { mcpServers: body.mcpServers } : {}),
            },
            expiresAt,
          },
        ]);
      });
    } catch (err) {
      return c.json({ error: `commit failed: ${(err as Error).message}` }, 500);
    }

    await deps.runtimeMutator.enqueueAfterCommit(agentId);
    return c.json({ ok: true, eventId, expiresAt: expiresAt.toISOString() });
  });
}
