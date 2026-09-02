import { SHARED_KB_TEMPLATE_ID } from "api-server-api";
import type { Hono } from "hono";

import { securityLog } from "../../core/security-log.js";
import type { K8sClient } from "../../modules/agents/infrastructure/k8s.js";
import type { ConnectionsRepository } from "../../modules/connections/infrastructure/connections-repository.js";
import type { SecretStore } from "../../modules/secret-store/services/secret-store.js";
import { resolveAgent } from "./agent-auth.js";

export interface AgentKbDeps {
  k8s: K8sClient;
  kbMcp: { fetch: (req: Request) => Response | Promise<Response> };
  connections: Pick<ConnectionsRepository, "listConnectionsForAgent">;
  secretStore: Pick<SecretStore, "getField">;
}

async function agentShareTokens(
  deps: AgentKbDeps,
  agentId: string,
): Promise<{ name: string; value: string }[]> {
  const conns = await deps.connections.listConnectionsForAgent(agentId);
  const tokens: { name: string; value: string }[] = [];
  for (const conn of conns) {
    if (conn.templateId !== SHARED_KB_TEMPLATE_ID) continue;
    if (conn.auth.kind !== "header") continue;
    const value = await deps.secretStore.getField(conn.auth.valueRef);
    if (value) tokens.push({ name: conn.auth.headerName, value });
  }
  return tokens;
}

export function mountAgentKbRoutes(app: Hono, deps: AgentKbDeps): void {
  app.all("/api/agents/:id/kb", async (c) => {
    const agentId = c.req.param("id")!;
    const verified = await resolveAgent(deps.k8s, agentId);
    if (!verified) {
      securityLog("warn", "kb_consume.resolve_fail", {
        category: "authn",
        actor: agentId,
        actorKind: "agent",
        surface: "mcp",
        agentId,
        decision: "deny",
        reason: "agent-unresolved",
      });
      return c.json({ error: "not found" }, 404);
    }

    const tokens = await agentShareTokens(deps, agentId);
    const headers = new Headers(c.req.raw.headers);
    for (const token of tokens) headers.set(token.name, token.value);

    const url = new URL(c.req.raw.url);
    url.pathname = "/mcp/kb";
    const method = c.req.raw.method;
    const hasBody = method !== "GET" && method !== "HEAD";
    const body = hasBody ? await c.req.raw.arrayBuffer() : undefined;
    return deps.kbMcp.fetch(new Request(url, { method, headers, body }));
  });
}
