import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import type { Hono } from "hono";
import type { HarnessContext, RuntimeDeliveryService } from "api-server-api";
import { harnessRouter } from "api-server-api/harness-router";
import type { K8sClient } from "../../modules/agents/infrastructure/k8s.js";
import { resolveAgent } from "./agent-auth.js";

export interface RuntimeTrpcDeps {
  k8s: K8sClient;
  hello: RuntimeDeliveryService;
}

export function mountRuntimeTrpc(app: Hono, deps: RuntimeTrpcDeps): void {
  app.all("/api/agents/:id/trpc/*", async (c) => {
    const agentId = c.req.param("id")!;
    const verified = await resolveAgent(deps.k8s, agentId);
    if (!verified) {
      return c.json({ error: "not found" }, 404);
    }

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
      }),
    });
  });
}
