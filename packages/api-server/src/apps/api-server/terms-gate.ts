import type { MiddlewareHandler } from "hono";
import type {
  TermsService,
  UserIdentity,
  StaleAcceptance,
} from "api-server-api";

export interface TermsGateConfig {
  terms: TermsService;
}

const TRPC_PREFIX = "/api/trpc/";

function isTermsOnlyTrpcCall(path: string): boolean {
  if (!path.startsWith(TRPC_PREFIX)) return false;
  const procs = path.slice(TRPC_PREFIX.length).split(",");
  return procs.length > 0 && procs.every((p) => p.startsWith("terms."));
}

export function createTermsGate(config: TermsGateConfig) {
  const middleware: MiddlewareHandler<{
    Variables: { user: UserIdentity };
  }> = async (c, next) => {
    if (isTermsOnlyTrpcCall(c.req.path)) return next();
    const user = c.get("user");
    if (!user) return next();
    const accepted = await config.terms.isAccepted(user.sub);
    if (accepted) return next();
    const current = config.terms.current();
    const body: StaleAcceptance = {
      error: "terms_stale",
      currentVersion: current.version,
      currentHash: current.hash,
    };
    return c.json(body, 412);
  };
  return { middleware };
}
