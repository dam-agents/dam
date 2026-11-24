import { t } from "../../trpc.js";
import {
  agentPermission,
  agentTarget,
  checkAgentBinding,
  manageAgentsProcedure,
  readAgentProcedure,
} from "../../auth-procedures.js";
import {
  webSearchSetRuleInputSchema,
  webSearchStateInputSchema,
} from "./schemas.js";

export const webSearchRouter = t.router({
  state: readAgentProcedure
    .input(webSearchStateInputSchema)
    .use(agentPermission("view", (input) => agentTarget(input.agentId)))
    .query(({ ctx, input }) => {
      checkAgentBinding(ctx, input.agentId);
      return ctx.webSearch.state(input.agentId);
    }),

  setRule: manageAgentsProcedure
    .input(webSearchSetRuleInputSchema)
    .use(agentPermission("egressRules", (input) => agentTarget(input.agentId)))
    .mutation(({ ctx, input }) => {
      checkAgentBinding(ctx, input.agentId);
      return ctx.webSearch.setRule(input.agentId, input.verdict);
    }),
});
