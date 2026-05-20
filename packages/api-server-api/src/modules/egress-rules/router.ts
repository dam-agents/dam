import { t } from "../../trpc.js";
import {
  egressRuleApplyPresetInputSchema,
  egressRuleCreateInputSchema,
  egressRuleCurrentPresetInputSchema,
  egressRuleListForAgentInputSchema,
  egressRuleRevokeInputSchema,
  egressRuleUpdateInputSchema,
} from "./schemas.js";

export const egressRulesRouter = t.router({
  listForAgent: t.procedure
    .input(egressRuleListForAgentInputSchema)
    .query(({ ctx, input }) => ctx.egressRules.listForAgent(input.agentId)),

  currentPreset: t.procedure
    .input(egressRuleCurrentPresetInputSchema)
    .query(({ ctx, input }) => ctx.egressRules.currentPreset(input.agentId)),

  create: t.procedure
    .input(egressRuleCreateInputSchema)
    .mutation(({ ctx, input }) => ctx.egressRules.create(input)),

  update: t.procedure
    .input(egressRuleUpdateInputSchema)
    .mutation(({ ctx, input }) => ctx.egressRules.update(input)),

  revoke: t.procedure
    .input(egressRuleRevokeInputSchema)
    .mutation(({ ctx, input }) => ctx.egressRules.revoke(input.id)),

  applyPreset: t.procedure
    .input(egressRuleApplyPresetInputSchema)
    .mutation(({ ctx, input }) =>
      ctx.egressRules.applyPreset(input.agentId, input.preset),
    ),

  trustedHosts: t.procedure.query(({ ctx }) => ctx.egressRules.trustedHosts()),
});
