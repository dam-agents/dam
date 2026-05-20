import { t } from "../../trpc.js";
import {
  sessionCreateInputSchema,
  sessionDeleteInputSchema,
  sessionListByScheduleIdInputSchema,
  sessionListInputSchema,
  sessionResetByScheduleIdInputSchema,
  sessionResolveTerminalInputSchema,
  sessionSetModeInputSchema,
} from "./schemas.js";

export const sessionsRouter = t.router({
  list: t.procedure
    .input(sessionListInputSchema)
    .query(({ ctx, input }) =>
      ctx.sessions.list(input.agentId, input.includeChannel),
    ),

  create: t.procedure
    .input(sessionCreateInputSchema)
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
    .input(sessionSetModeInputSchema)
    .mutation(({ ctx, input }) =>
      ctx.sessions.setMode(input.sessionId, input.agentId, input.mode),
    ),

  delete: t.procedure
    .input(sessionDeleteInputSchema)
    .mutation(({ ctx, input }) =>
      ctx.sessions.delete(input.sessionId, input.agentId),
    ),

  listByScheduleId: t.procedure
    .input(sessionListByScheduleIdInputSchema)
    .query(({ ctx, input }) => ctx.sessions.listByScheduleId(input.scheduleId)),

  resetByScheduleId: t.procedure
    .input(sessionResetByScheduleIdInputSchema)
    .mutation(({ ctx, input }) =>
      ctx.sessions.resetByScheduleId(input.scheduleId),
    ),

  resolveTerminal: t.procedure
    .input(sessionResolveTerminalInputSchema)
    .mutation(({ ctx, input }) =>
      ctx.sessions.resolveTerminal(input.agentId, input.strategy, {
        reset: input.reset,
        force: input.force,
      }),
    ),
});
