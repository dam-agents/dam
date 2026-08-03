import { TRPCError } from "@trpc/server";
import { t } from "../../trpc.js";
import {
  checkAgentBinding,
  manageAgentsProcedure,
  readAgentProcedure,
} from "../../auth-procedures.js";
import {
  scheduleCreateCronInputSchema,
  scheduleCreateRRuleInputSchema,
  scheduleDeleteInputSchema,
  scheduleGetInputSchema,
  scheduleListInputSchema,
  scheduleResetSessionInputSchema,
  scheduleToggleInputSchema,
  scheduleUpdateRRuleInputSchema,
} from "./schemas.js";
import type { Schedule } from "./types.js";

function toView(sched: Schedule) {
  const base = {
    id: sched.id,
    name: sched.name,
    agentId: sched.agentId,
    type: sched.spec.type,
    task: sched.spec.task ?? null,
    enabled: sched.spec.enabled,
    sessionMode: sched.spec.sessionMode,
    createdBy: sched.spec.createdBy,
    status: sched.status ?? null,
  };
  if (sched.spec.type === "rrule") {
    return {
      ...base,
      cron: null,
      rrule: sched.spec.rrule,
      timezone: sched.spec.timezone,
      quietHours: sched.spec.quietHours ?? [],
    };
  }
  return {
    ...base,
    cron: sched.spec.cron,
    rrule: null,
    timezone: null,
    quietHours: [],
  };
}

export const schedulesRouter = t.router({
  list: readAgentProcedure
    .input(scheduleListInputSchema)
    .query(async ({ ctx, input }) => {
      checkAgentBinding(ctx, input.agentId);
      const schedules = await ctx.schedules.list(input.agentId);
      return schedules.map(toView);
    }),

  get: readAgentProcedure
    .input(scheduleGetInputSchema)
    .query(async ({ ctx, input }) => {
      const sched = await ctx.schedules.get(input.id);
      if (!sched) throw new TRPCError({ code: "NOT_FOUND" });
      checkAgentBinding(ctx, sched.agentId);
      return toView(sched);
    }),

  createCron: manageAgentsProcedure
    .input(scheduleCreateCronInputSchema)
    .mutation(async ({ ctx, input }) => {
      const sched = await ctx.schedules.createCron(input);
      return toView(sched);
    }),

  createRRule: manageAgentsProcedure
    .input(scheduleCreateRRuleInputSchema)
    .mutation(async ({ ctx, input }) => {
      const sched = await ctx.schedules.createRRule(input);
      return toView(sched);
    }),

  updateRRule: manageAgentsProcedure
    .input(scheduleUpdateRRuleInputSchema)
    .mutation(async ({ ctx, input }) => {
      const sched = await ctx.schedules.updateRRule(input);
      if (!sched) throw new TRPCError({ code: "NOT_FOUND" });
      return toView(sched);
    }),

  delete: manageAgentsProcedure
    .input(scheduleDeleteInputSchema)
    .mutation(({ ctx, input }) => ctx.schedules.delete(input.id)),

  toggle: manageAgentsProcedure
    .input(scheduleToggleInputSchema)
    .mutation(async ({ ctx, input }) => {
      const sched = await ctx.schedules.toggle(input.id);
      if (!sched) throw new TRPCError({ code: "NOT_FOUND" });
      return toView(sched);
    }),

  resetSession: manageAgentsProcedure
    .input(scheduleResetSessionInputSchema)
    .mutation(({ ctx, input }) => ctx.schedules.resetSession(input.id)),
});
