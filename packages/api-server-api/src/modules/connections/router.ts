import { t } from "../../trpc.js";
import {
  connectionGetAgentConnectionsInputSchema,
  connectionSetAgentConnectionsInputSchema,
} from "./schemas.js";

export const connectionsRouter = t.router({
  list: t.procedure.query(({ ctx }) => ctx.connections.list()),

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
