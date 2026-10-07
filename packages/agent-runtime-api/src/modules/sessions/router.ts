import { t } from "../../trpc.js";
import {
  delegationFramesInputSchema,
  sessionHistoryInputSchema,
  sessionListInputSchema,
  storeDelegationFramesInputSchema,
} from "./schemas.js";

export const sessionsRouter = t.router({
  list: t.procedure
    .input(sessionListInputSchema)
    .query(({ ctx, input }) => ctx.sessions.list(input)),

  history: t.procedure
    .input(sessionHistoryInputSchema)
    .query(({ ctx, input }) => ctx.sessions.history(input.sessionId)),

  storeDelegationFrames: t.procedure
    .input(storeDelegationFramesInputSchema)
    .mutation(({ ctx, input }) => ctx.sessions.storeDelegationFrames(input)),

  delegationFrames: t.procedure
    .input(delegationFramesInputSchema)
    .query(({ ctx, input }) =>
      ctx.sessions.delegationFrames(input.invocationId),
    ),

  watch: t.procedure.subscription(async function* ({ ctx, signal }) {
    for await (const notice of ctx.sessions.watch(signal)) yield notice;
  }),
});
