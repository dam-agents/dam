import { t } from "../../trpc.js";
import {
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

export const spendRouter = t.router({
  daily: readAgentProcedure
    .input(spendDailyInputSchema)
    .query(({ ctx, input }) => {
      if (input.agentId) checkAgentBinding(ctx, input.agentId);
      return ctx.spend.daily(input);
    }),

  breakdown: readAgentProcedure
    .input(spendBreakdownInputSchema)
    .query(({ ctx, input }) => {
      if (input.agentId) checkAgentBinding(ctx, input.agentId);
      return ctx.spend.breakdown(input);
    }),

  sessions: readAgentProcedure
    .input(spendSessionsInputSchema)
    .query(({ ctx, input }) => {
      checkAgentBinding(ctx, input.agentId);
      return ctx.spend.sessions(input);
    }),

  subAgents: readAgentProcedure
    .input(spendSubAgentsInputSchema)
    .query(({ ctx, input }) => {
      checkAgentBinding(ctx, input.agentId);
      return ctx.spend.subAgents(input);
    }),

  turns: readAgentProcedure
    .input(spendTurnsInputSchema)
    .query(({ ctx, input }) => {
      checkAgentBinding(ctx, input.agentId);
      return ctx.spend.turns(input);
    }),

  calls: readAgentProcedure
    .input(spendCallsInputSchema)
    .query(({ ctx, input }) => {
      checkAgentBinding(ctx, input.agentId);
      return ctx.spend.calls(input);
    }),

  metering: readAgentProcedure.query(({ ctx }) => ctx.spend.metering()),

  status: readAgentProcedure
    .input(spendStatusInputSchema)
    .query(({ ctx, input }) => {
      if (input?.agentId) checkAgentBinding(ctx, input.agentId);
      return ctx.spend.status(input);
    }),

  setLimit: manageAgentsProcedure
    .input(spendSetLimitInputSchema)
    .mutation(({ ctx, input }) => ctx.spend.setLimit(input)),

  ceilings: t.router({
    list: operatorProcedure.query(({ ctx }) => ctx.spendCeilings.list()),

    set: operatorProcedure
      .input(spendCeilingSetInputSchema)
      .mutation(({ ctx, input }) => ctx.spendCeilings.set(input)),
  }),
});
