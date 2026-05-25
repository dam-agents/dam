import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import type { Hono } from "hono";
import type {
  HarnessContext,
  RuntimeDeliveryService,
  TriggerEventHandler,
} from "api-server-api";
import { harnessRouter } from "api-server-api/harness-router";
import type { K8sClient } from "../../modules/agents/infrastructure/k8s.js";
import { resolveAgent } from "./agent-auth.js";

/**
 * Mount the harness runtime tRPC router on the existing Hono app
 * (ADR-022, ADR-052). Routes live under `/api/agents/:id/trpc/*` so they
 * fall under the same per-agent AuthorizationPolicy as MCP, pod-files, and
 * the trigger endpoint (ADR-041).
 *
 * The agent identity in the URL is authenticated by the waypoint; the
 * application resolves the Agent ConfigMap to confirm liveness and then
 * builds the HarnessContext with the resolved agentId.
 */
export interface RuntimeTrpcDeps {
  k8s: K8sClient;
  hello: RuntimeDeliveryService;
  triggerHandler: TriggerEventHandler;
}

export function mountRuntimeTrpc(app: Hono, deps: RuntimeTrpcDeps): void {
  app.all("/api/agents/:id/trpc/*", async (c) => {
    const agentId = c.req.param("id")!;
    const verified = await resolveAgent(deps.k8s, agentId);
    if (!verified) {
      return c.json({ error: "not found" }, 404);
    }

    // Strip `/api/agents/:id/trpc` so the fetch adapter sees `/<procedure>`.
    const url = new URL(c.req.url);
    const prefix = `/api/agents/${encodeURIComponent(agentId)}/trpc`;
    const path = url.pathname.startsWith(prefix)
      ? url.pathname.slice(prefix.length).replace(/^\/+/, "")
      : url.pathname;

    return fetchRequestHandler({
      endpoint: "",
      req: new Request(`${url.origin}/${path}${url.search}`, {
        method: c.req.method,
        headers: c.req.raw.headers,
        body:
          c.req.method === "GET" || c.req.method === "HEAD"
            ? undefined
            : c.req.raw.body,
        duplex: "half",
      } as RequestInit),
      router: harnessRouter,
      createContext: (): HarnessContext => ({
        agentId,
        runtimeDelivery: deps.hello,
        triggerHandler: deps.triggerHandler,
      }),
    });
  });
}
