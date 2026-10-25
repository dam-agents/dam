import { t } from "../../trpc.js";
import {
  agentPermission,
  agentTarget,
  checkAgentBinding,
  manageAgentsProcedure,
  operatorProcedure,
  readAgentProcedure,
} from "../../auth-procedures.js";
import {
  spendBreakdownInputSchema,
  spendCallsInputSchema,
  spendCeilingSetInputSchema,
  spendDailyInputSchema,
  spendSessionsInputSchema,
  spendSetLimitInputSchema,
  spendStatusInputSchema,
  spendSubAgentsInputSchema,
  spendTurnsInputSchema,
} from "./schemas.js";
import type { SpendLimitScope } from "./types.js";

function limitTarget(scope: SpendLimitScope) {
  return agentTarget("agentId" in scope ? scope.agentId : undefined);
}

export const spendRouter = t.router({
  daily: readAgentProcedure
    .input(spendDailyInputSchema)
    .use(agentPermission("view", (input) => agentTarget(input.agentId)))
    .query(({ ctx, input }) => {
      if (input.agentId) checkAgentBinding(ctx, input.agentId);
      return ctx.spend.daily(input);
    }),

  breakdown: readAgentProcedure
    .input(spendBreakdownInputSchema)
    .use(agentPermission("view", (input) => agentTarget(input.agentId)))
    .query(({ ctx, input }) => {
      if (input.agentId) checkAgentBinding(ctx, input.agentId);
      return ctx.spend.breakdown(input);
    }),

  sessions: readAgentProcedure
    .input(spendSessionsInputSchema)
    .use(agentPermission("view", (input) => agentTarget(input.agentId)))
    .query(({ ctx, input }) => {
      checkAgentBinding(ctx, input.agentId);
      return ctx.spend.sessions(input);
    }),

  subAgents: readAgentProcedure
    .input(spendSubAgentsInputSchema)
    .use(agentPermission("view", (input) => agentTarget(input.agentId)))
    .query(({ ctx, input }) => {
      checkAgentBinding(ctx, input.agentId);
      return ctx.spend.subAgents(input);
    }),

  turns: readAgentProcedure
    .input(spendTurnsInputSchema)
    .use(agentPermission("view", (input) => agentTarget(input.agentId)))
    .query(({ ctx, input }) => {
      checkAgentBinding(ctx, input.agentId);
      return ctx.spend.turns(input);
    }),

  calls: readAgentProcedure
    .input(spendCallsInputSchema)
    .use(agentPermission("view", (input) => agentTarget(input.agentId)))
    .query(({ ctx, input }) => {
      checkAgentBinding(ctx, input.agentId);
      return ctx.spend.calls(input);
    }),

  metering: readAgentProcedure.query(({ ctx }) => ctx.spend.metering()),

  status: readAgentProcedure
    .input(spendStatusInputSchema)
    .use(agentPermission("view", (input) => agentTarget(input?.agentId)))
    .query(({ ctx, input }) => {
      if (input?.agentId) checkAgentBinding(ctx, input.agentId);
      return ctx.spend.status(input);
    }),

  setLimit: manageAgentsProcedure
    .input(spendSetLimitInputSchema)
    .use(agentPermission("spendLimits", (input) => limitTarget(input.scope)))
    .mutation(({ ctx, input }) => ctx.spend.setLimit(input)),

  ceilings: t.router({
    list: operatorProcedure.query(({ ctx }) => ctx.spendCeilings.list()),

    set: operatorProcedure
      .input(spendCeilingSetInputSchema)
      .mutation(({ ctx, input }) => ctx.spendCeilings.set(input)),
  }),
});
