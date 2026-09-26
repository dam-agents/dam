import { t } from "../../trpc.js";

export const sessionsRouter = t.router({
  list: t.procedure.query(async ({ ctx }) => ({
    sessions: await ctx.sessions.list(),
  })),

  watch: t.procedure.subscription(async function* ({ ctx, signal }) {
    for await (const notice of ctx.sessions.watch(signal)) yield notice;
  }),
});
