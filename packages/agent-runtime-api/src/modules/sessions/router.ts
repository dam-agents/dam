import { protectedProcedure, t } from "../../trpc.js";
import { sessionHistoryInputSchema } from "./schemas.js";

export const sessionsRouter = t.router({
  list: protectedProcedure.query(async ({ ctx }) => ({
    sessions: await ctx.sessions.list(),
  })),

  history: protectedProcedure
    .input(sessionHistoryInputSchema)
    .query(({ ctx, input }) => ctx.sessions.history(input.sessionId)),

  watch: protectedProcedure.subscription(async function* ({ ctx, signal }) {
    for await (const notice of ctx.sessions.watch(signal)) yield notice;
  }),
});
