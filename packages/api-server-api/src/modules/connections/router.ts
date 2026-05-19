import { z } from "zod";
import { t } from "../../trpc.js";

export const connectionsRouter = t.router({
  list: t.procedure.query(({ ctx }) => ctx.connections.list()),

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
