import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { t } from "../../trpc.js";
import type { Schedule } from "./types.js";

// Quiet-hours window: inclusive start, exclusive end, in the schedule's
// timezone. endTime < startTime is valid and denotes a crosses-midnight
// window (e.g. 22:00–06:00) — the controller evaluates these as
// [start, 24:00) ∪ [00:00, end). See ADR-031 for semantics.
const quietWindowSchema = z
  .object({
    startTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "HH:MM required"),
    endTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "HH:MM required"),
    enabled: z.boolean(),
  })
  .refine((w) => w.startTime !== w.endTime, {
    message: "startTime and endTime must differ",
  });

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
  list: t.procedure
    .input(z.object({ agentId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const schedules = await ctx.schedules.list(input.agentId);
      return schedules.map(toView);
    }),

  get: t.procedure
    .input(z.object({ id: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const sched = await ctx.schedules.get(input.id);
      if (!sched) throw new TRPCError({ code: "NOT_FOUND" });
      return toView(sched);
    }),

  createCron: t.procedure
    .input(
      z.object({
        name: z.string().min(1),
        agentId: z.string().min(1),
        cron: z.string().min(1),
        task: z.string().min(1),
        sessionMode: z.enum(["continuous", "fresh"]).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const sched = await ctx.schedules.createCron(input);
      return toView(sched);
    }),

  createRRule: t.procedure
    .input(
      z.object({
        name: z.string().min(1),
        agentId: z.string().min(1),
        rrule: z.string().min(1),
        timezone: z.string().min(1),
        quietHours: z.array(quietWindowSchema).optional(),
        task: z.string().min(1),
        sessionMode: z.enum(["continuous", "fresh"]).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const sched = await ctx.schedules.createRRule(input);
      return toView(sched);
    }),

  updateRRule: t.procedure
    .input(
      z.object({
        id: z.string().min(1),
        name: z.string().min(1),
        rrule: z.string().min(1),
        timezone: z.string().min(1),
        quietHours: z.array(quietWindowSchema),
        task: z.string().min(1),
        sessionMode: z.enum(["continuous", "fresh"]).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const sched = await ctx.schedules.updateRRule(input);
      if (!sched) throw new TRPCError({ code: "NOT_FOUND" });
      return toView(sched);
    }),

  delete: t.procedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(({ ctx, input }) => ctx.schedules.delete(input.id)),

  toggle: t.procedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const sched = await ctx.schedules.toggle(input.id);
      if (!sched) throw new TRPCError({ code: "NOT_FOUND" });
      return toView(sched);
    }),
});
