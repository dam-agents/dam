import { TRPCError } from "@trpc/server";
import { t } from "./trpc.js";
import type { ApiContext } from "./context.js";
import { AGENT_SCOPES, CREDENTIAL_SCOPES } from "./modules/api-keys/schemas.js";
import type { Scope } from "./modules/api-keys/types.js";

function requireScope(...scopes: readonly Scope[]) {
  return t.middleware(({ ctx, next }) => {
    const granted = new Set(ctx.user.scopes);
    if (!scopes.some((s) => granted.has(s))) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: `Requires one of: ${scopes.join(", ")}`,
      });
    }
    return next();
  });
}

export const requireWildcardBinding = t.middleware(({ ctx, next }) => {
  if (ctx.user.agentIds !== "*") {
    throw new TRPCError({
      code: "FORBIDDEN",
      message:
        "this operation spans all of the owner's agents and requires an unrestricted (wildcard) principal; agent-bound API keys are refused.",
    });
  }
  return next();
});

export const readAgentProcedure = t.procedure.use(
  requireScope(...AGENT_SCOPES),
);

export const operateAgentsProcedure = t.procedure.use(
  requireScope("agents:operate"),
);

export const manageAgentsProcedure = t.procedure
  .use(requireScope("agents:manage"))
  .use(requireWildcardBinding);

export const readCredentialsProcedure = t.procedure.use(
  requireScope(...CREDENTIAL_SCOPES),
);

export const manageCredentialsProcedure = t.procedure.use(
  requireScope("credentials:manage"),
);

export const browserOnlyProcedure = t.procedure.use(({ ctx, next }) => {
  if (ctx.user.keyId !== undefined) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message:
        "API keys cannot manage API keys. Use the web UI or an interactive CLI login session.",
    });
  }
  return next();
});

export function checkAgentBinding(ctx: ApiContext, agentId: string): void {
  if (ctx.user.agentIds === "*") return;
  if (!ctx.user.agentIds.includes(agentId)) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: `API key is not bound to agent ${agentId}`,
    });
  }
}
