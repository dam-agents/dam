import {
  checkAgentBinding,
  operateAgentsProcedure,
  readAgentProcedure,
  requireWildcardBinding,
} from "../../auth-procedures.js";
import { t } from "../../trpc.js";

import {
  attentionDismissInputSchema,
  attentionSessionsForAgentInputSchema,
} from "./schemas.js";

export const attentionRouter = t.router({
  listForOwner: readAgentProcedure
    .use(requireWildcardBinding)
    .query(({ ctx }) => ctx.attention.listForOwner()),

  sessionsForAgent: readAgentProcedure
    .input(attentionSessionsForAgentInputSchema)
    .query(({ ctx, input }) => {
      checkAgentBinding(ctx, input.agentId);
      return ctx.attention.sessionsForAgent(input.agentId);
    }),

  dismiss: operateAgentsProcedure
    .use(requireWildcardBinding)
    .input(attentionDismissInputSchema)
    .mutation(({ ctx, input }) => ctx.attention.dismiss(input)),
});
