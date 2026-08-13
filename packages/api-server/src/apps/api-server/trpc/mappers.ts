import type { AuthDenialKind } from "../admission/auth.js";
import type { TermsDenialKind } from "../admission/terms.js";

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
