import { z } from "zod";
import { t } from "../../trpc.js";
import {
  checkAgentBinding,
  operateAgentsProcedure,
  readAgentProcedure,
} from "../../auth-procedures.js";

export const forksRouter = t.router({
  listByAgent: readAgentProcedure
    .input(z.object({ agentId: z.string().min(1) }))
    .query(({ ctx, input }) => {
      checkAgentBinding(ctx, input.agentId);
      return ctx.forks.listByAgent(input.agentId);
    }),
  // Owner scoping happens in the service (forks acting as the caller);
  // there is no agent-targeted input to bind an API key to.
  listMine: readAgentProcedure.query(({ ctx }) => ctx.forks.listMine()),
  end: operateAgentsProcedure
    .input(z.object({ forkId: z.string().min(1) }))
    .mutation(({ ctx, input }) => ctx.forks.end(input.forkId)),
});
