import { z } from "zod";
import { t } from "../../trpc.js";
import { SessionMode, SessionType, sessionModeSchema } from "./types.js";

const sessionType = z.enum([
  SessionType.Regular,
  SessionType.ChannelSlack,
  SessionType.ChannelTelegram,
  SessionType.ScheduleCron,
]);

export const sessionsRouter = t.router({
  list: t.procedure
    .input(
      z.object({
        instanceId: z.string().min(1),
        includeChannel: z.boolean().optional(),
      }),
    )
    .query(({ ctx, input }) =>
      ctx.sessions.list(input.instanceId, input.includeChannel),
    ),

  create: t.procedure
    .input(
      z.object({
        sessionId: z.string().min(1),
        instanceId: z.string().min(1),
        type: sessionType.optional(),
        scheduleId: z.string().optional(),
        // Default at the API edge so existing clients omitting `mode` still
        // land at "chat"; internal callers receive a concrete SessionMode.
        mode: sessionModeSchema.default(SessionMode.Chat),
      }),
    )
    .mutation(({ ctx, input }) =>
      ctx.sessions.create(
        input.sessionId,
        input.instanceId,
        input.mode,
        input.type,
        input.scheduleId,
      ),
    ),

  setMode: t.procedure
    .input(
      z.object({
        sessionId: z.string().min(1),
        instanceId: z.string().min(1),
        mode: sessionModeSchema,
      }),
    )
    .mutation(({ ctx, input }) =>
      ctx.sessions.setMode(input.sessionId, input.instanceId, input.mode),
    ),

  delete: t.procedure
    .input(
      z.object({ sessionId: z.string().min(1), instanceId: z.string().min(1) }),
    )
    .mutation(({ ctx, input }) =>
      ctx.sessions.delete(input.sessionId, input.instanceId),
    ),

  listByScheduleId: t.procedure
    .input(z.object({ scheduleId: z.string().min(1) }))
    .query(({ ctx, input }) => ctx.sessions.listByScheduleId(input.scheduleId)),

  resetByScheduleId: t.procedure
    .input(z.object({ scheduleId: z.string().min(1) }))
    .mutation(({ ctx, input }) =>
      ctx.sessions.resetByScheduleId(input.scheduleId),
    ),

  resolveTerminal: t.procedure
    .input(
      z.object({
        instanceId: z.string().min(1),
        strategy: z.discriminatedUnion("kind", [
          z.object({ kind: z.literal("new") }),
          z.object({ kind: z.literal("continue") }),
          z.object({ kind: z.literal("resume"), sessionId: z.string().min(1) }),
        ]),
        reset: z.boolean().optional(),
        force: z.boolean().optional(),
      }),
    )
    .mutation(({ ctx, input }) =>
      ctx.sessions.resolveTerminal(input.instanceId, input.strategy, {
        reset: input.reset,
        force: input.force,
      }),
    ),
});
