import { t } from "../../trpc.js";
import {
  browserOnlyProcedure,
  readAgentProcedure,
  requireWildcardBinding,
} from "../../auth-procedures.js";
import {
  sidebarPinAgentsInputSchema,
  sidebarPinSessionsInputSchema,
} from "./schemas.js";

export const sidebarPinsRouter = t.router({
  get: readAgentProcedure
    .use(requireWildcardBinding)
    .query(({ ctx }) => ctx.sidebarPins.get()),

  setAgents: browserOnlyProcedure
    .input(sidebarPinAgentsInputSchema)
    .mutation(({ ctx, input }) => ctx.sidebarPins.setAgents(input.agentIds)),

  setSessions: browserOnlyProcedure
    .input(sidebarPinSessionsInputSchema)
    .mutation(({ ctx, input }) =>
      ctx.sidebarPins.setSessions(input.agentId, input.sessionIds),
    ),
});
