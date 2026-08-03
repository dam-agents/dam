import { t } from "../../trpc.js";
import {
  checkAgentBinding,
  manageAgentsProcedure,
  manageCredentialsProcedure,
  readAgentProcedure,
  readCredentialsProcedure,
} from "../../auth-procedures.js";
import {
  connectionCreateInputSchema,
  connectionDiscoverMcpInputSchema,
  connectionProbeClusterCaInputSchema,
  connectionGetAgentConnectionsInputSchema,
  connectionIdInputSchema,
  connectionSetAgentConnectionsInputSchema,
  connectionStartOAuthInputSchema,
  connectionTestAnthropicInputSchema,
  connectionUpdateInputSchema,
} from "./schemas.js";

function messageForStatus(status: number): string {
  if (status === 401) return "Invalid credential.";
  if (status === 403) return "Credential lacks required permissions.";
  if (status === 429) return "Rate limited by Anthropic.";
  if (status >= 500) return "Anthropic is unavailable right now.";
  return `Unexpected response (${status}).`;
}

export const connectionsRouter = t.router({
  // Global connection catalog + lifecycle — credentials:* scopes.
  listTemplates: readCredentialsProcedure.query(({ ctx }) =>
    ctx.connections.listTemplates(),
  ),

  list: readCredentialsProcedure.query(({ ctx }) =>
    ctx.connections.listConnections(),
  ),

  get: readCredentialsProcedure
    .input(connectionIdInputSchema)
    .query(({ ctx, input }) => ctx.connections.getConnection(input.id)),

  create: manageCredentialsProcedure
    .input(connectionCreateInputSchema)
    .mutation(({ ctx, input }) =>
      ctx.connections.createFromTemplate(input).then((id) => ({ id })),
    ),

  startOAuth: manageCredentialsProcedure
    .input(connectionStartOAuthInputSchema)
    .mutation(({ ctx, input }) =>
      ctx.connections.startOAuth(input.connectionId, {
        returnTo: input.returnTo,
        popup: input.popup,
      }),
    ),

  discoverMcp: manageCredentialsProcedure
    .input(connectionDiscoverMcpInputSchema)
    .mutation(({ ctx, input }) => ctx.connections.discoverMcp(input)),

  probeClusterCa: manageCredentialsProcedure
    .input(connectionProbeClusterCaInputSchema)
    .mutation(({ ctx, input }) => ctx.connections.probeClusterCa(input)),

  update: manageCredentialsProcedure
    .input(connectionUpdateInputSchema)
    .mutation(({ ctx, input }) =>
      ctx.connections.update(input.id, input.value),
    ),

  delete: manageCredentialsProcedure
    .input(connectionIdInputSchema)
    .mutation(({ ctx, input }) => ctx.connections.deleteConnection(input.id)),

  // Validates a caller-supplied Anthropic key/token against Anthropic before
  // save; reads no stored state, so it's a plain inline handler.
  testAnthropic: readCredentialsProcedure
    .input(connectionTestAnthropicInputSchema)
    .mutation(async ({ input }) => {
      const headers: Record<string, string> = {
        "anthropic-version": "2023-06-01",
      };
      if (input.envName === "ANTHROPIC_API_KEY") {
        headers["x-api-key"] = input.value;
      } else {
        headers["Authorization"] = `Bearer ${input.value}`;
        headers["anthropic-beta"] = "oauth-2025-04-20";
      }
      try {
        const res = await fetch("https://api.anthropic.com/v1/models?limit=1", {
          method: "GET",
          headers,
        });
        if (res.ok) return { ok: true as const };
        return {
          ok: false as const,
          status: res.status,
          message: messageForStatus(res.status),
        };
      } catch {
        return { ok: false as const, message: "Could not reach Anthropic." };
      }
    }),

  // Per-agent grant linkage is agent configuration: reading it needs an agent
  // scope; assigning is agents:manage (the agent is the resource being
  // configured, not the connection itself).
  getAgentConnections: readAgentProcedure
    .input(connectionGetAgentConnectionsInputSchema)
    .query(({ ctx, input }) => {
      checkAgentBinding(ctx, input.agentId);
      return ctx.connections.getAgentConnections(input.agentId);
    }),

  setAgentConnections: manageAgentsProcedure
    .input(connectionSetAgentConnectionsInputSchema)
    .mutation(({ ctx, input }) =>
      ctx.connections.setAgentConnections(input.agentId, input.connectionIds),
    ),
});
