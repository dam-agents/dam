import { t } from "../../trpc.js";
import {
  connectionCreateInputSchema,
  connectionDiscoverMcpInputSchema,
  connectionGetAgentConnectionsInputSchema,
  connectionIdInputSchema,
  connectionSetAgentConnectionsInputSchema,
  connectionStartOAuthInputSchema,
} from "./schemas.js";

export const connectionsRouter = t.router({
  listTemplates: t.procedure.query(({ ctx }) =>
    ctx.connections.listTemplates(),
  ),

  list: t.procedure.query(({ ctx }) => ctx.connections.listConnections()),

  get: t.procedure
    .input(connectionIdInputSchema)
    .query(({ ctx, input }) => ctx.connections.getConnection(input.id)),

  create: t.procedure
    .input(connectionCreateInputSchema)
    .mutation(({ ctx, input }) =>
      ctx.connections.createFromTemplate(input).then((id) => ({ id })),
    ),

  startOAuth: t.procedure
    .input(connectionStartOAuthInputSchema)
    .mutation(({ ctx, input }) =>
      ctx.connections.startOAuth(input.connectionId, {
        returnTo: input.returnTo,
        popup: input.popup,
      }),
    ),

  discoverMcp: t.procedure
    .input(connectionDiscoverMcpInputSchema)
    .mutation(({ ctx, input }) => ctx.connections.discoverMcp(input)),

  delete: t.procedure
    .input(connectionIdInputSchema)
    .mutation(({ ctx, input }) => ctx.connections.deleteConnection(input.id)),

  getAgentConnections: t.procedure
    .input(connectionGetAgentConnectionsInputSchema)
    .query(({ ctx, input }) =>
      ctx.connections.getAgentConnections(input.agentId),
    ),

  setAgentConnections: t.procedure
    .input(connectionSetAgentConnectionsInputSchema)
    .mutation(({ ctx, input }) =>
      ctx.connections.setAgentConnections(input.agentId, input.connectionIds),
    ),
});
