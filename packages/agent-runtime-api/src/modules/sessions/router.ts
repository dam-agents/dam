import { protectedProcedure, t } from "../../trpc.js";

export const sessionsRouter = t.router({
  list: protectedProcedure.query(async ({ ctx }) => ({
    sessions: await ctx.sessions.list(),
  })),
});
