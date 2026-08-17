import type { Context } from "hono";
import type { UserIdentity } from "api-server-api";
import { getLogger } from "../../../core/logger.js";
import { securityLog } from "../../../core/security-log.js";
import {
  isAgentStoppedError,
  isAgentWakeTimeoutError,
} from "../../../modules/agents/index.js";
import { podBaseUrl } from "../../../modules/agents/infrastructure/k8s.js";
import { clientIp, hasAgentBinding, hasScope } from "../admission/auth.js";
import type { ApiVariables } from "../deps.js";

export interface AgentTrpcProxyDeps {
  namespace: string;
  verifyOwner: (agentId: string, ownerSub: string) => Promise<boolean>;
  ensureReady: (agentId: string) => Promise<unknown>;
}

type ProxyCtx = Context<{ Variables: ApiVariables }>;

export function createAgentTrpcProxy(deps: AgentTrpcProxyDeps) {
  return async (c: ProxyCtx) => {
    const user = c.get("user");
    const agentId = c.req.param("id")!;
    if (!(await deps.verifyOwner(agentId, user.sub))) {
      securityLog("warn", "authz.owner_mismatch", {
        category: "authz",
        actor: user.sub,
        actorKind: "user",
        agentId,
        decision: "deny",
        reason: "not-owner",
        sourceIp: clientIp(c),
        detail: { surface: "trpc-proxy" },
      });
      return c.json({ error: "not found" }, 404);
    }
    if (!hasScope(user, "agents:operate")) {
      return c.json(
        { error: "forbidden", message: "Requires agents:operate" },
        403,
      );
    }
    if (!hasAgentBinding(user, agentId)) {
      return c.json(
        {
          error: "forbidden",
          message: `API key is not bound to agent ${agentId}`,
        },
        403,
      );
    }

    try {
      await deps.ensureReady(agentId);
    } catch (err) {
      getLogger().warn(
        { agentId, error: (err as Error).message },
        "trpc-proxy.ensure-ready.failed",
      );
      return c.json(
        {
          error: "agent unreachable",
          ...(isAgentWakeTimeoutError(err) ? { reason: err.failure.kind } : {}),
          ...(isAgentStoppedError(err) ? { reason: "stopped" } : {}),
        },
        502,
      );
    }

    const rest = c.req.path.replace(`/api/agents/${agentId}/trpc`, "");
    const qs = c.req.url.includes("?") ? "?" + c.req.url.split("?")[1] : "";
    const upstreamUrl = `http://${podBaseUrl(agentId, deps.namespace)}/api/trpc${rest}${qs}`;
    try {
      const headers = new Headers(c.req.raw.headers);
      headers.delete("host");
      headers.delete("authorization");
      const upstream = await fetch(upstreamUrl, {
        method: c.req.method,
        headers,
        body:
          c.req.method !== "GET" && c.req.method !== "HEAD"
            ? c.req.raw.body
            : undefined,
        // @ts-expect-error -- node fetch supports duplex
        duplex: "half",
      });
      return new Response(upstream.body, {
        status: upstream.status,
        headers: upstream.headers,
      });
    } catch {
      return c.json({ error: "agent unreachable" }, 502);
    }
  };
}
