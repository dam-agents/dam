import type { AuthDenialKind } from "../admission/auth.js";
import type { TermsDenialKind } from "../admission/terms.js";

/** How the tRPC WS endpoint answers a refused admission — the TRPCError
 *  encoding of every denial kind the gates composed in its createContext
 *  can produce. The HTTP door has no table: its denials are delivered
 *  upstream by the middleware chain (see admission/mappers.ts); the relays'
 *  twin lives in agent-proxies/mappers.ts. */
export const trpcDenial: Record<
  AuthDenialKind | TermsDenialKind,
  {
    code: "UNAUTHORIZED" | "FORBIDDEN" | "INTERNAL_SERVER_ERROR";
    message: string;
  }
> = {
  "missing-token": {
    code: "UNAUTHORIZED",
    message: "missing connection token",
  },
  unauthorized: { code: "UNAUTHORIZED", message: "authentication failed" },
  forbidden: { code: "FORBIDDEN", message: "authentication failed" },
  "auth-unavailable": {
    code: "INTERNAL_SERVER_ERROR",
    message: "authentication unavailable",
  },
  "terms-stale": { code: "FORBIDDEN", message: "terms not accepted" },
};
