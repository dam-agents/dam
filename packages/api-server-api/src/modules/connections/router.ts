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
  connectionGetAgentConnectionsInputSchema,
  connectionIdInputSchema,
  connectionSetAgentConnectionsInputSchema,
  connectionStartOAuthInputSchema,
} from "./schemas.js";

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

  delete: manageCredentialsProcedure
    .input(connectionIdInputSchema)
    .mutation(({ ctx, input }) => ctx.connections.deleteConnection(input.id)),

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
