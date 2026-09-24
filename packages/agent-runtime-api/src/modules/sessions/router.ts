import { t } from "../../trpc.js";
import { sessionHistoryInputSchema } from "./schemas.js";

export const sessionsRouter = t.router({
  list: t.procedure.query(async ({ ctx }) => ({
    sessions: await ctx.sessions.list(),
  })),

  history: t.procedure
    .input(sessionHistoryInputSchema)
    .query(({ ctx, input }) => ctx.sessions.history(input.sessionId)),

  watch: t.procedure.subscription(async function* ({ ctx, signal }) {
    for await (const notice of ctx.sessions.watch(signal)) yield notice;
  }),
});
