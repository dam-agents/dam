import type { MiddlewareHandler } from "hono";
import { PRE_TERMS_PROCEDURES } from "api-server-api";
import type {
  StaleAcceptance,
  TermsService,
  UserIdentity,
} from "api-server-api";

const TRPC_PREFIX = "/api/trpc/";

export function isTermsOnlyTrpcCall(rawPathname: string): boolean {
  if (!rawPathname.startsWith(TRPC_PREFIX)) return false;
  let procs: string[];
  try {
    procs = decodeURIComponent(rawPathname.slice(TRPC_PREFIX.length)).split(
      ",",
    );
  } catch {
    return false;
  }
  return procs.length > 0 && procs.every((p) => PRE_TERMS_PROCEDURES.has(p));
}

export function createTermsGate(
  terms: TermsService,
): MiddlewareHandler<{ Variables: { user: UserIdentity } }> {
  return async (c, next) => {
    const user = c.get("user");
    if (!user) return next();
    const accepted = await terms.isAccepted(user.sub);
    if (accepted) return next();
    const current = terms.current();
    return c.json(
      {
        error: "terms_stale",
        currentVersion: current.version,
        currentHash: current.hash,
      } satisfies StaleAcceptance,
      412,
    );
  };
}
