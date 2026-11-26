import type { TRPCError } from "@trpc/server";
import { getLogger } from "../../../core/logger.js";
import { securityLog } from "../../../core/security-log.js";

function refusedAgentCaller(error: TRPCError): string | undefined {
  const cause: unknown = error.cause;
  if (error.code !== "FORBIDDEN" || !cause || typeof cause !== "object")
    return undefined;
  const caller = (cause as { agentCaller?: unknown }).agentCaller;
  return typeof caller === "string" ? caller : undefined;
}

export function logInternalError(opts: {
  error: TRPCError;
  path: string | undefined;
}): void {
  const agentId = refusedAgentCaller(opts.error);
  if (agentId !== undefined)
    securityLog("warn", "agent.self_act", {
      category: "authz",
      actor: agentId,
      actorKind: "agent",
      agentId,
      result: "failure",
      decision: "deny",
      reason: "procedure-closed-to-agents",
      detail: { procedure: opts.path },
    });
  if (opts.error.code !== "INTERNAL_SERVER_ERROR") return;
  getLogger().error(
    { err: opts.error.cause ?? opts.error, path: opts.path },
    "trpc internal error",
  );
}
