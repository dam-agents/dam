import { TRPCError, type TRPCMiddlewareFunction } from "@trpc/server";
import { t } from "./trpc.js";
import type { ApiContext } from "./context.js";
import type {
  AgentPermission,
  AgentTarget,
} from "./modules/agents/permissions.js";
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

export const serveSatellitesProcedure = t.procedure
  .use(requireScope("satellites:serve"))
  .use(requireWildcardBinding);

export const operatorProcedure = t.procedure.use(({ ctx, next }) => {
  if (ctx.user.isOperator !== true) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "This needs the platform operator role.",
    });
  }
  return next();
});

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

export const signedInProcedure = t.procedure.use(({ ctx, next }) => {
  if (ctx.user.keyId !== undefined) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "This needs a person signed in, not an API key.",
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

export function agentTarget(agentId: string | undefined): AgentTarget | null {
  return agentId === undefined ? null : { kind: "agent", agentId };
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: The check an agent-scoped procedure declares:
 * which Agent Permission it needs on the Agent its input names. Only an Agent
 * Editor is affected. An editor who holds the permission runs the procedure
 * in the owner's context, bound to that one Agent, because the Agent runs on
 * its owner's budget, connections and skill library. An editor without it
 * gets FORBIDDEN. Everyone else runs as themselves, so the services' own
 * owner checks answer them as before.
 */
export function agentPermission<TInput>(
  permission: AgentPermission,
  targetOf: (input: TInput) => AgentTarget | null,
): TRPCMiddlewareFunction<ApiContext, object, object, object, TInput> {
  return async ({ ctx, input, path, type, next }) => {
    const target = targetOf(input);
    if (target === null) return next();
    const acting = await ctx.actOnAgent(target, permission, {
      path,
      mutation: type === "mutation",
    });
    if (!acting.ok)
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Only the agent's owner can do this.",
      });
    return acting.ctx === ctx ? next() : next({ ctx: acting.ctx });
  };
}
