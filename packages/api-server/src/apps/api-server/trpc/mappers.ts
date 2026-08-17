import type { AuthDenialKind } from "../admission/auth.js";

export const trpcDenial: Record<
  AuthDenialKind,
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
};
