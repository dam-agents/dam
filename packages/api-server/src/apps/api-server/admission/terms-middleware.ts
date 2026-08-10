import type { MiddlewareHandler } from "hono";
import type { TermsService, UserIdentity } from "api-server-api";
import { httpTermsStale } from "./mappers.js";

export interface TermsGateConfig {
  terms: TermsService;
}

const TRPC_PREFIX = "/api/trpc/";

/** The terms.* procedures must stay reachable for a stale user — they are
 *  how acceptance happens. Batched calls pass only when every procedure in
 *  the batch is terms-scoped. Used as the `except(…)` condition at the
 *  mount site in app.ts. */
export function isTermsOnlyTrpcCall(path: string): boolean {
  if (!path.startsWith(TRPC_PREFIX)) return false;
  const procs = path.slice(TRPC_PREFIX.length).split(",");
  return procs.length > 0 && procs.every((p) => p.startsWith("terms."));
}

/** The HTTP edge of the terms gate; the WS flavor lives in terms.ts.
 *  Exemptions live at the mount site in app.ts. */
export function createTermsGate(config: TermsGateConfig) {
  const middleware: MiddlewareHandler<{
    Variables: { user: UserIdentity };
  }> = async (c, next) => {
    const user = c.get("user");
    if (!user) return next();
    const accepted = await config.terms.isAccepted(user.sub);
    if (accepted) return next();
    const { status, body } = httpTermsStale(config.terms.current());
    return c.json(body, status);
  };
  return { middleware };
}
