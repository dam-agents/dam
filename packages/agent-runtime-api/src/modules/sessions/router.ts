import { protectedProcedure, t } from "../../trpc.js";

export const sessionsRouter = t.router({
  list: protectedProcedure.query(async ({ ctx }) => ({
    sessions: await ctx.sessions.list(),
  })),

  watch: protectedProcedure.subscription(async function* ({ ctx, signal }) {
    for await (const notice of ctx.sessions.watch(signal)) yield notice;
  }),
});
