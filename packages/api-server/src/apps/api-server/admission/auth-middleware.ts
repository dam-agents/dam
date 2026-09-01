import type { MiddlewareHandler } from "hono";
import {
  clientIp,
  clientSurface,
  emitUserAuthenticated,
  type Authenticate,
  type SurfaceAttribution,
} from "./auth.js";
import { httpAuthDenial } from "./mappers.js";

export function createAuthMiddleware(
  authenticate: Authenticate,
  attribution: SurfaceAttribution,
): MiddlewareHandler {
  return async (c, next) => {
    const authHeader = c.req.header("authorization");
    const token = authHeader?.startsWith("Bearer ")
      ? authHeader.slice(7)
      : null;

    const admitted = await authenticate(token, {
      edge: "http",
      target: c.req.path,
      sourceIp: clientIp(c),
    });
    if (!admitted.ok) {
      const { status, body } = httpAuthDenial[admitted.kind];
      return c.json(body, status);
    }

    const { user, roles } = admitted.principal;
    c.set("user", user);
    c.set("roles", roles);
    c.set("surface", clientSurface(admitted.principal, attribution));
    emitUserAuthenticated(admitted.principal, attribution);
    return next();
  };
}
