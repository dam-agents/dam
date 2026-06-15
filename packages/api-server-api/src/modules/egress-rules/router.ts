import { t } from "../../trpc.js";
import {
  checkAgentBinding,
  manageAgentsProcedure,
  readAgentProcedure,
} from "../../auth-procedures.js";
import {
  egressRuleApplyPresetInputSchema,
  egressRuleCreateInputSchema,
  egressRuleCurrentPresetInputSchema,
  egressRuleListForAgentInputSchema,
  egressRuleRevokeInputSchema,
  egressRuleUpdateInputSchema,
} from "./schemas.js";

export const egressRulesRouter = t.router({
  listForAgent: readAgentProcedure
    .input(egressRuleListForAgentInputSchema)
    .query(({ ctx, input }) => {
      checkAgentBinding(ctx, input.agentId);
      return ctx.egressRules.listForAgent(input.agentId);
    }),

  currentPreset: readAgentProcedure
    .input(egressRuleCurrentPresetInputSchema)
    .query(({ ctx, input }) => {
      checkAgentBinding(ctx, input.agentId);
      return ctx.egressRules.currentPreset(input.agentId);
    }),

  create: manageAgentsProcedure
    .input(egressRuleCreateInputSchema)
    .mutation(({ ctx, input }) => ctx.egressRules.create(input)),

  update: manageAgentsProcedure
    .input(egressRuleUpdateInputSchema)
    .mutation(({ ctx, input }) => ctx.egressRules.update(input)),

  revoke: manageAgentsProcedure
    .input(egressRuleRevokeInputSchema)
    .mutation(({ ctx, input }) => ctx.egressRules.revoke(input.id)),

  applyPreset: manageAgentsProcedure
    .input(egressRuleApplyPresetInputSchema)
    .mutation(({ ctx, input }) =>
      ctx.egressRules.applyPreset(input.agentId, input.preset),
    ),

  trustedHosts: readAgentProcedure.query(({ ctx }) =>
    ctx.egressRules.trustedHosts(),
  ),
});
