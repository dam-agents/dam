import type { Context } from "hono";
import { getLogger } from "../../../core/logger.js";
import { formatError } from "../../../core/format-error.js";
import {
  hasErrorCode,
  retryWhileUnreachable,
} from "../../../core/retry-unreachable.js";
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
  upstreamBase?: (agentId: string) => string;
}

const CONNECT_RETRY_BUDGET_MS = 2_000;
const CONNECT_RETRY_FIRST_DELAY_MS = 100;
const CONNECT_RETRY_MAX_DELAY_MS = 800;
const REPLAYABLE_BODY_MAX_BYTES = 1024 * 1024;
const NEVER_REACHED_CODES = new Set([
  "ECONNREFUSED",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "ENOTFOUND",
  "EAI_AGAIN",
  "UND_ERR_CONNECT_TIMEOUT",
]);
const MAYBE_REACHED_CODES = new Set(["ECONNRESET", "EPIPE", "UND_ERR_SOCKET"]);

function retryableFor(method: string, replayable: boolean) {
  if (method === "GET" || method === "HEAD")
    return (err: unknown) =>
      hasErrorCode(err, NEVER_REACHED_CODES) ||
      hasErrorCode(err, MAYBE_REACHED_CODES);
  if (replayable)
    return (err: unknown) => hasErrorCode(err, NEVER_REACHED_CODES);
  return () => false;
}

async function replayableBody(req: Request): Promise<BodyInit | null> {
  if (req.method === "GET" || req.method === "HEAD") return null;
  const length = Number(req.headers.get("content-length") ?? NaN);
  return length <= REPLAYABLE_BODY_MAX_BYTES
    ? new Uint8Array(await req.arrayBuffer())
    : req.body;
}

type ProxyCtx = Context<{ Variables: ApiVariables }>;

export function createAgentTrpcProxy(deps: AgentTrpcProxyDeps) {
  const upstreamBase =
    deps.upstreamBase ??
    ((agentId: string) => `http://${podBaseUrl(agentId, deps.namespace)}`);
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
    const upstreamUrl = `${upstreamBase(agentId)}/api/trpc${rest}${qs}`;
    const headers = new Headers(c.req.raw.headers);
    headers.delete("host");
    headers.delete("authorization");
    try {
      const body = await replayableBody(c.req.raw);
      const replayable = !(body instanceof ReadableStream);
      const upstream = await retryWhileUnreachable(
        "trpc-proxy",
        () =>
          fetch(upstreamUrl, {
            method: c.req.method,
            headers,
            body,
            // @ts-expect-error -- node fetch supports duplex
            duplex: "half",
          }),
        {
          budgetMs: CONNECT_RETRY_BUDGET_MS,
          delayMs: CONNECT_RETRY_FIRST_DELAY_MS,
          maxDelayMs: CONNECT_RETRY_MAX_DELAY_MS,
          retryable: retryableFor(c.req.method, replayable),
          log: (msg) => getLogger().info({ agentId }, msg),
        },
      );
      return new Response(upstream.body, {
        status: upstream.status,
        headers: upstream.headers,
      });
    } catch (err) {
      getLogger().warn(
        {
          agentId,
          method: c.req.method,
          error: formatError(err),
          cause:
            err instanceof Error && err.cause
              ? formatError(err.cause)
              : undefined,
        },
        "trpc-proxy.upstream.failed",
      );
      return c.json({ error: "agent unreachable" }, 502);
    }
  };
}
