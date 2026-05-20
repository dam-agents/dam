import { z } from "zod";
import { t } from "../../trpc.js";
import { sessionModeSchema } from "./types.js";
import {
  createSessionInputSchema,
  resolveTerminalInputSchema,
} from "./schemas.js";

export const sessionsRouter = t.router({
  list: t.procedure
    .input(
      z.object({
        agentId: z.string().min(1),
        includeChannel: z.boolean().optional(),
      }),
    )
    .query(({ ctx, input }) =>
      ctx.sessions.list(input.agentId, input.includeChannel),
    ),

  create: t.procedure
    .input(createSessionInputSchema)
    .mutation(({ ctx, input }) =>
      ctx.sessions.create(
        input.sessionId,
        input.agentId,
        input.mode,
        input.type,
        input.scheduleId,
      ),
    ),

  setMode: t.procedure
    .input(
      z.object({
        sessionId: z.string().min(1),
        agentId: z.string().min(1),
        mode: sessionModeSchema,
      }),
    )
    .mutation(({ ctx, input }) =>
      ctx.sessions.setMode(input.sessionId, input.agentId, input.mode),
    ),

  delete: t.procedure
    .input(
      z.object({ sessionId: z.string().min(1), agentId: z.string().min(1) }),
    )
    .mutation(({ ctx, input }) =>
      ctx.sessions.delete(input.sessionId, input.agentId),
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
    .input(resolveTerminalInputSchema)
    .mutation(({ ctx, input }) =>
      ctx.sessions.resolveTerminal(input.agentId, input.strategy, {
        reset: input.reset,
        force: input.force,
      }),
    ),
});
