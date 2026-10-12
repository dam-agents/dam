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
