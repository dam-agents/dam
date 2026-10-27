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
  scheduleCreateCronInputSchema,
  scheduleCreateOnceInputSchema,
  scheduleCreateRRuleInputSchema,
  scheduleDeleteInputSchema,
  scheduleGetInputSchema,
  scheduleListForOwnerInputSchema,
  scheduleListInputSchema,
  scheduleClearSessionChoicesInputSchema,
  scheduleResetSessionInputSchema,
  scheduleRunNowInputSchema,
  scheduleToggleInputSchema,
  scheduleUpdateCronInputSchema,
  scheduleUpdateOnceInputSchema,
  scheduleUpdateRRuleInputSchema,
} from "./schemas.js";
import type { AgentTarget } from "../agents/permissions.js";
import type { OnceSessionChoice, Schedule, ScheduleSpecOnce } from "./types.js";

function onceSessionChoice(spec: ScheduleSpecOnce): OnceSessionChoice {
  return spec.origin?.mode ?? "fresh";
}

function toView(sched: Schedule) {
  const base = {
    id: sched.id,
    name: sched.name,
    agentId: sched.agentId,
    type: sched.spec.type,
    task: sched.spec.task ?? null,
    precheck: sched.spec.precheck ?? null,
    harness: sched.spec.harness ?? null,
    model: sched.spec.model ?? null,
    profile: sched.spec.profile ?? null,
    platformSubagentProfile: sched.spec.platformSubagentProfile ?? null,
    platformSubagentSettings: sched.spec.platformSubagentSettings ?? null,
    settings: sched.spec.settings ?? null,
    migrationNote: sched.spec.migrationNote ?? null,
    sessionTitle: sched.spec.sessionTitle ?? null,
    enabled: sched.spec.enabled,
    sessionMode: sched.spec.sessionMode,
    createdBy: sched.spec.createdBy,
    status: sched.status ?? null,
  };
  const spec = sched.spec;
  switch (spec.type) {
    case "cron":
      return {
        ...base,
        cron: spec.cron,
        rrule: null,
        inSession: null,
        at: null,
        timezone: null,
        quietHours: [],
      };
    case "rrule":
      return {
        ...base,
        cron: null,
        rrule: spec.rrule,
        inSession: null,
        at: null,
        timezone: spec.timezone,
        quietHours: spec.quietHours ?? [],
      };
    case "once":
      return {
        ...base,
        cron: null,
        rrule: null,
        inSession: onceSessionChoice(spec),
        at: spec.at,
        timezone: spec.timezone,
        quietHours: [],
      };
  }
}

function scheduleTarget(scheduleIds: readonly string[]): AgentTarget {
  return { kind: "schedules", scheduleIds };
}

export const schedulesRouter = t.router({
  list: readAgentProcedure
    .input(scheduleListInputSchema)
    .use(agentPermission("view", (input) => agentTarget(input.agentId)))
    .query(async ({ ctx, input }) => {
      checkAgentBinding(ctx, input.agentId);
      const schedules = await ctx.schedules.list(input.agentId);
      return schedules.map(toView);
    }),

  listForOwner: readAgentProcedure
    .input(scheduleListForOwnerInputSchema)
    .query(async ({ ctx, input }) => {
      const schedules = await ctx.schedules.listForOwner(input?.limit);
      return schedules.map(toView);
    }),

  get: readAgentProcedure
    .input(scheduleGetInputSchema)
    .use(agentPermission("view", (input) => scheduleTarget([input.id])))
    .query(async ({ ctx, input }) => {
      const sched = await ctx.schedules.get(input.id);
      if (!sched) throw new TRPCError({ code: "NOT_FOUND" });
      checkAgentBinding(ctx, sched.agentId);
      return toView(sched);
    }),

  createCron: manageAgentsProcedure
    .input(scheduleCreateCronInputSchema)
    .use(agentPermission("schedules", (input) => agentTarget(input.agentId)))
    .mutation(async ({ ctx, input }) => {
      const sched = await ctx.schedules.createCron(input);
      return toView(sched);
    }),

  updateCron: manageAgentsProcedure
    .input(scheduleUpdateCronInputSchema)
    .use(agentPermission("schedules", (input) => scheduleTarget([input.id])))
    .mutation(async ({ ctx, input }) => {
      const sched = await ctx.schedules.updateCron(input);
      if (!sched) throw new TRPCError({ code: "NOT_FOUND" });
      return toView(sched);
    }),

  createRRule: manageAgentsProcedure
    .input(scheduleCreateRRuleInputSchema)
    .use(agentPermission("schedules", (input) => agentTarget(input.agentId)))
    .mutation(async ({ ctx, input }) => {
      const sched = await ctx.schedules.createRRule(input);
      return toView(sched);
    }),

  updateRRule: manageAgentsProcedure
    .input(scheduleUpdateRRuleInputSchema)
    .use(agentPermission("schedules", (input) => scheduleTarget([input.id])))
    .mutation(async ({ ctx, input }) => {
      const sched = await ctx.schedules.updateRRule(input);
      if (!sched) throw new TRPCError({ code: "NOT_FOUND" });
      return toView(sched);
    }),

  createOnce: manageAgentsProcedure
    .input(scheduleCreateOnceInputSchema)
    .use(agentPermission("schedules", (input) => agentTarget(input.agentId)))
    .mutation(async ({ ctx, input }) => {
      const sched = await ctx.schedules.createOnce(input);
      return toView(sched);
    }),

  updateOnce: manageAgentsProcedure
    .input(scheduleUpdateOnceInputSchema)
    .use(agentPermission("schedules", (input) => scheduleTarget([input.id])))
    .mutation(async ({ ctx, input }) => {
      const sched = await ctx.schedules.updateOnce(input);
      if (!sched) throw new TRPCError({ code: "NOT_FOUND" });
      return toView(sched);
    }),

  delete: manageAgentsProcedure
    .input(scheduleDeleteInputSchema)
    .use(agentPermission("schedules", (input) => scheduleTarget([input.id])))
    .mutation(({ ctx, input }) => ctx.schedules.delete(input.id)),

  toggle: manageAgentsProcedure
    .input(scheduleToggleInputSchema)
    .use(agentPermission("schedules", (input) => scheduleTarget([input.id])))
    .mutation(async ({ ctx, input }) => {
      const sched = await ctx.schedules.toggle(input.id, input.enabled);
      if (!sched) throw new TRPCError({ code: "NOT_FOUND" });
      return toView(sched);
    }),

  clearSessionChoices: manageAgentsProcedure
    .input(scheduleClearSessionChoicesInputSchema)
    .use(agentPermission("schedules", (input) => scheduleTarget(input.ids)))
    .mutation(async ({ ctx, input }) => {
      const failed: { id: string; reason: string }[] = [];
      for (const id of input.ids) {
        try {
          if (!(await ctx.schedules.clearSessionChoices(id)))
            failed.push({ id, reason: "schedule not found" });
        } catch (err) {
          failed.push({
            id,
            reason: err instanceof Error ? err.message : String(err),
          });
        }
      }
      return { failed };
    }),

  resetSession: manageAgentsProcedure
    .input(scheduleResetSessionInputSchema)
    .use(agentPermission("schedules", (input) => scheduleTarget([input.id])))
    .mutation(({ ctx, input }) => ctx.schedules.resetSession(input.id)),

  runNow: manageAgentsProcedure
    .input(scheduleRunNowInputSchema)
    .use(agentPermission("schedules", (input) => scheduleTarget([input.id])))
    .mutation(({ ctx, input }) => ctx.schedules.runNow(input.id)),
});
