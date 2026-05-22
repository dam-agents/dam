import type { Hono } from "hono";
import {
  runtimeChannelAckInputSchema,
  runtimeChannelHelloInputSchema,
} from "api-server-api";
import { resolveAgent } from "./agent-auth.js";
import type { K8sClient } from "../../modules/agents/infrastructure/k8s.js";
import type { HelloAckService } from "../../modules/runtime-channel/index.js";

export interface RuntimeChannelRoutesDeps {
  k8s: K8sClient;
  helloAck: HelloAckService;
}

/** Mounts the agent → server side of the unified runtime channel at
 *  `/api/agents/:id/runtime/v1/*`. Same path shape as MCP and pod-files
 *  so the per-instance Istio AuthorizationPolicy admits the agent's
 *  SPIFFE principal here without an extra rule (ADR-041). */
export function mountRuntimeChannelRoutes(
  app: Hono,
  deps: RuntimeChannelRoutesDeps,
): void {
  app.post("/api/agents/:id/runtime/v1/hello", async (c) => {
    const agentId = c.req.param("id")!;
    const verified = await resolveAgent(deps.k8s, agentId);
    if (!verified) return c.json({ error: "not found" }, 404);

    const body = await c.req.json();
    const parsed = runtimeChannelHelloInputSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: parsed.error.message }, 400);
    }
    const result = await deps.helloAck.hello({ agentId, hello: parsed.data });
    return c.json(result);
  });

  app.post("/api/agents/:id/runtime/v1/ack", async (c) => {
    const agentId = c.req.param("id")!;
    const verified = await resolveAgent(deps.k8s, agentId);
    if (!verified) return c.json({ error: "not found" }, 404);

    const body = await c.req.json();
    const parsed = runtimeChannelAckInputSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: parsed.error.message }, 400);
    }
    await deps.helloAck.ack({ agentId, signalId: parsed.data.signalId });
    return c.json({ ok: true } as const);
  });
}
