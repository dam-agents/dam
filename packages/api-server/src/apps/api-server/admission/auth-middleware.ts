import type { MiddlewareHandler } from "hono";
import {
  clientIp,
  clientSurface,
  emitUserAuthenticated,
  type Authenticate,
  type AuthDenialKind,
  type SurfaceAttribution,
} from "./auth.js";
import { watchApiKey } from "./api-key-watch.js";
import { AGENT_CALLER_REFUSAL } from "api-server-api";
import { securityLog } from "../../../core/security-log.js";

const TRPC_PREFIX = "/api/trpc/";

const httpAuthDenial: Record<
  AuthDenialKind,
  { status: 401 | 403 | 503; body: Record<string, string> }
> = {
  "missing-token": { status: 401, body: { error: "unauthorized" } },
  unauthorized: { status: 401, body: { error: "unauthorized" } },
  "auth-unavailable": { status: 503, body: { error: "auth unavailable" } },
  forbidden: {
    status: 403,
    body: {
      error: "forbidden",
      message: "Access pending approval. Contact your administrator.",
    },
  },
};

export function createAuthMiddleware(
  authenticate: Authenticate,
  attribution: SurfaceAttribution,
): MiddlewareHandler {
  return async (c, next) => {
    const authHeader = c.req.header("authorization");
    const token = authHeader?.startsWith("Bearer ")
      ? authHeader.slice(7)
      : null;

    const site = {
      edge: "http" as const,
      target: c.req.path,
      sourceIp: clientIp(c),
    };
    const admitted = await authenticate(token, site);
    if (!admitted.ok) {
      const { status, body } = httpAuthDenial[admitted.kind];
      return c.json(body, status);
    }

    const { user, roles } = admitted.principal;
    if (user.actingAgent !== undefined && !c.req.path.startsWith(TRPC_PREFIX)) {
      securityLog("warn", "agent.self_act", {
        category: "authz",
        actor: user.actingAgent,
        actorKind: "agent",
        agentId: user.actingAgent,
        result: "failure",
        decision: "deny",
        reason: "route-closed-to-agents",
        target: c.req.path,
        sourceIp: site.sourceIp,
      });
      return c.json({ error: "forbidden", message: AGENT_CALLER_REFUSAL }, 403);
    }
    c.set("user", user);
    c.set("roles", roles);
    c.set("surface", clientSurface(admitted.principal, attribution));
    emitUserAuthenticated(admitted.principal, attribution);
    if (user.keyId === undefined) return next();
    await next();

    const body = c.res.body;
    if (
      !body ||
      !c.res.headers.get("content-type")?.startsWith("text/event-stream")
    ) {
      return;
    }
    const keyDead = new AbortController();
    const stop = watchApiKey(authenticate, token, site, () => keyDead.abort());
    const { readable, writable } = new TransformStream<Uint8Array>();
    void body
      .pipeTo(writable, { signal: keyDead.signal })
      .catch(() => {})
      .finally(stop);
    c.res = new Response(readable, c.res);
  };
}
