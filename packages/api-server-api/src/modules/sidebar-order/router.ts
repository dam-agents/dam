import { t } from "../../trpc.js";
import {
  browserOnlyProcedure,
  readAgentProcedure,
  requireWildcardBinding,
} from "../../auth-procedures.js";
import {
  sidebarOrderAgentsInputSchema,
  sidebarOrderSessionsInputSchema,
} from "./schemas.js";

export const sidebarOrderRouter = t.router({
  get: readAgentProcedure
    .use(requireWildcardBinding)
    .query(({ ctx }) => ctx.sidebarOrder.get()),

  setAgents: browserOnlyProcedure
    .input(sidebarOrderAgentsInputSchema)
    .mutation(({ ctx, input }) => ctx.sidebarOrder.setAgents(input.agentIds)),

  setSessions: browserOnlyProcedure
    .input(sidebarOrderSessionsInputSchema)
    .mutation(({ ctx, input }) =>
      ctx.sidebarOrder.setSessions(input.agentId, input.sessionIds),
    ),
});
