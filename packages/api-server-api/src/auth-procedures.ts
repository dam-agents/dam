import { TRPCError } from "@trpc/server";
import { t } from "./trpc.js";
import type { ApiContext } from "./context.js";
import { AGENT_SCOPES, CREDENTIAL_SCOPES } from "./modules/api-keys/schemas.js";
import type { Scope } from "./modules/api-keys/types.js";

/**
 * tRPC middleware that gates a procedure to one or more scopes. The request
 * is allowed if the principal has ANY of the listed scopes (OR semantics).
 */
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

/**
 * Rejects keys restricted to a specific agent set. `agents:manage` is
 * wildcard-bound by design — per-agent downscoping of management is a future
 * refinement — so every management procedure layers this guard on top of the
 * scope check.
 */
const requireWildcardBinding = t.middleware(({ ctx, next }) => {
  if (ctx.user.agentIds !== "*") {
    throw new TRPCError({
      code: "FORBIDDEN",
      message:
        "agents:manage requires an unrestricted (wildcard) API key; agent-bound keys cannot manage configuration.",
    });
  }
  return next();
});

/** Read-only view of agents and their configuration: list/get agents,
 *  templates, channels, schedules, skills, egress rules, credential
 *  assignments. No mutations, no run. Allowed for any agent scope. */
export const readAgentProcedure = t.procedure.use(
  requireScope(...AGENT_SCOPES),
);

/** Operate a live agent: respond to approvals, upload workspace files. Running
 *  can mutate state through the agent runtime (filesystem, schedules via the
 *  in-pod MCP server), so this is not read-only. Supports both wildcard and
 *  per-agent binding — pair with `checkAgentBinding` on agent-targeted calls. */
export const operateAgentsProcedure = t.procedure.use(
  requireScope("agents:operate"),
);

/** Full agent configuration + lifecycle: CRUD, channels, schedules, skills,
 *  egress rules, and credential assignment. Wildcard-bound by design. */
export const manageAgentsProcedure = t.procedure
  .use(requireScope("agents:manage"))
  .use(requireWildcardBinding);

/** Read connections and secrets. Implied by `credentials:manage`. */
export const readCredentialsProcedure = t.procedure.use(
  requireScope(...CREDENTIAL_SCOPES),
);

/** Global credential lifecycle: connections (OAuth) and secrets (user-supplied)
 *  create/update/delete. The grant linkage between a credential and an agent is
 *  `agents:manage`. */
export const manageCredentialsProcedure = t.procedure.use(
  requireScope("credentials:manage"),
);

/** Rejects API-key principals. Applied to the `apiKeys.*` surface so a key can
 *  never mint, list, or revoke API keys — that requires an interactive Keycloak
 *  session (web UI or CLI login). This is the single barrier behind which key
 *  self-management sits, so the api-keys service stays unaware of how the
 *  caller authenticated. */
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

/**
 * Per-call agent-binding guard for `agents:read` / `agents:operate` endpoints
 * that target a specific Agent ID — those scopes may be bound to a specific
 * agent set. Pass-through when the principal's binding is wildcard; throws when
 * the key is restricted to a different set. Management endpoints do NOT call
 * this: `manageAgentsProcedure` is wildcard-only (`requireWildcardBinding`), so
 * a per-call binding check there would always be a no-op. When per-agent
 * management downscoping lands, binding enforcement should move into the
 * procedure builder (compile-enforced), not be re-scattered across handlers.
 */
export function checkAgentBinding(ctx: ApiContext, agentId: string): void {
  if (ctx.user.agentIds === "*") return;
  if (!ctx.user.agentIds.includes(agentId)) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: `API key is not bound to agent ${agentId}`,
    });
  }
}
