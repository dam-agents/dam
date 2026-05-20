import { z } from "zod";
import { t } from "../../trpc.js";
import {
  applyEgressPresetInputSchema,
  createEgressRuleInputSchema,
  updateEgressRuleInputSchema,
} from "./schemas.js";

export const egressRulesRouter = t.router({
  listForAgent: t.procedure
    .input(z.object({ agentId: z.string().min(1) }))
    .query(({ ctx, input }) => ctx.egressRules.listForAgent(input.agentId)),

  currentPreset: t.procedure
    .input(z.object({ agentId: z.string().min(1) }))
    .query(({ ctx, input }) => ctx.egressRules.currentPreset(input.agentId)),

  create: t.procedure
    .input(createEgressRuleInputSchema)
    .mutation(({ ctx, input }) => ctx.egressRules.create(input)),

  update: t.procedure
    .input(updateEgressRuleInputSchema)
    .mutation(({ ctx, input }) => ctx.egressRules.update(input)),

  revoke: t.procedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(({ ctx, input }) => ctx.egressRules.revoke(input.id)),

  applyPreset: t.procedure
    .input(applyEgressPresetInputSchema)
    .mutation(({ ctx, input }) =>
      ctx.egressRules.applyPreset(input.agentId, input.preset),
    ),

  trustedHosts: t.procedure.query(({ ctx }) => ctx.egressRules.trustedHosts()),
});
