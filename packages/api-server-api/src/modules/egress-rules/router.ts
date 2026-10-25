import { TRPCError } from "@trpc/server";
import { t } from "../../trpc.js";
import {
  agentPermission,
  agentTarget,
  checkAgentBinding,
  manageAgentsProcedure,
  readAgentProcedure,
} from "../../auth-procedures.js";
import {
  egressRuleApplyPresetInputSchema,
  egressRuleCreateInputSchema,
  egressRuleCurrentPresetInputSchema,
  egressRuleGetInputSchema,
  egressRuleListForAgentInputSchema,
  egressRuleRevokeInputSchema,
  egressRuleUpdateInputSchema,
} from "./schemas.js";
import type { AgentTarget } from "../agents/permissions.js";

function ruleTarget(ruleId: string): AgentTarget {
  return { kind: "egressRule", ruleId };
}

export const egressRulesRouter = t.router({
  listForAgent: readAgentProcedure
    .input(egressRuleListForAgentInputSchema)
    .use(agentPermission("view", (input) => agentTarget(input.agentId)))
    .query(({ ctx, input }) => {
      checkAgentBinding(ctx, input.agentId);
      return ctx.egressRules.listForAgent(input.agentId);
    }),

  get: readAgentProcedure
    .input(egressRuleGetInputSchema)
    .use(agentPermission("view", (input) => ruleTarget(input.id)))
    .query(async ({ ctx, input }) => {
      const rule = await ctx.egressRules.get(input.id);
      try {
        checkAgentBinding(ctx, rule.agentId);
      } catch {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "egress rule not found",
        });
      }
      return rule;
    }),

  currentPreset: readAgentProcedure
    .input(egressRuleCurrentPresetInputSchema)
    .use(agentPermission("view", (input) => agentTarget(input.agentId)))
    .query(({ ctx, input }) => {
      checkAgentBinding(ctx, input.agentId);
      return ctx.egressRules.currentPreset(input.agentId);
    }),

  create: manageAgentsProcedure
    .input(egressRuleCreateInputSchema)
    .use(agentPermission("egressRules", (input) => agentTarget(input.agentId)))
    .mutation(({ ctx, input }) => ctx.egressRules.create(input)),

  update: manageAgentsProcedure
    .input(egressRuleUpdateInputSchema)
    .use(agentPermission("egressRules", (input) => ruleTarget(input.id)))
    .mutation(({ ctx, input }) => ctx.egressRules.update(input)),

  revoke: manageAgentsProcedure
    .input(egressRuleRevokeInputSchema)
    .use(agentPermission("egressRules", (input) => ruleTarget(input.id)))
    .mutation(({ ctx, input }) => ctx.egressRules.revoke(input.id)),

  applyPreset: manageAgentsProcedure
    .input(egressRuleApplyPresetInputSchema)
    .use(agentPermission("egressRules", (input) => agentTarget(input.agentId)))
    .mutation(({ ctx, input }) =>
      ctx.egressRules.applyPreset(input.agentId, input.preset),
    ),

  trustedHosts: readAgentProcedure.query(({ ctx }) =>
    ctx.egressRules.trustedHosts(),
  ),
});
