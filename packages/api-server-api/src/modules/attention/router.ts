import {
  agentPermission,
  agentTarget,
  checkAgentBinding,
  operateAgentsProcedure,
  readAgentProcedure,
  requireWildcardBinding,
} from "../../auth-procedures.js";
import { t } from "../../trpc.js";

import {
  attentionDismissInputSchema,
  attentionListForOwnerPageInputSchema,
  attentionSessionsForAgentInputSchema,
} from "./schemas.js";

export const attentionRouter = t.router({
  listForOwner: readAgentProcedure
    .use(requireWildcardBinding)
    .query(({ ctx }) => ctx.attention.listForOwner()),

  listForOwnerPage: readAgentProcedure
    .use(requireWildcardBinding)
    .input(attentionListForOwnerPageInputSchema)
    .query(({ ctx, input }) => ctx.attention.listForOwnerPage(input)),

  sessionsForAgent: readAgentProcedure
    .input(attentionSessionsForAgentInputSchema)
    .use(agentPermission("sessions", (input) => agentTarget(input.agentId)))
    .query(({ ctx, input }) => {
      checkAgentBinding(ctx, input.agentId);
      return ctx.attention.sessionsForAgent(input.agentId);
    }),

  dismiss: operateAgentsProcedure
    .use(requireWildcardBinding)
    .input(attentionDismissInputSchema)
    .mutation(({ ctx, input }) => ctx.attention.dismiss(input)),
});
