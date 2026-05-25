import { z } from "zod";
import { t } from "../../trpc.js";

export const connectionsRouter = t.router({
  listTemplates: t.procedure.query(({ ctx }) =>
    ctx.connections.listTemplates(),
  ),

  list: t.procedure.query(({ ctx }) => ctx.connections.listConnections()),

  get: t.procedure
    .input(z.object({ id: z.string().min(1) }))
    .query(({ ctx, input }) => ctx.connections.getConnection(input.id)),

  delete: t.procedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(({ ctx, input }) => ctx.connections.deleteConnection(input.id)),

  getAgentConnections: t.procedure
    .input(z.object({ agentId: z.string().min(1) }))
    .query(({ ctx, input }) =>
      ctx.connections.getAgentConnections(input.agentId),
    ),

  setAgentConnections: t.procedure
    .input(
      z.object({
        agentId: z.string().min(1),
        connectionIds: z.array(z.string().min(1)),
      }),
    )
    .mutation(({ ctx, input }) =>
      ctx.connections.setAgentConnections(input.agentId, input.connectionIds),
    ),
});
