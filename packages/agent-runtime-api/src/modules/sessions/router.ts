import { TRPCError } from "@trpc/server";
import { t } from "../../trpc.js";
import {
  delegationFramesInputSchema,
  sessionByRefInputSchema,
  sessionHistoryInputSchema,
  sessionListInputSchema,
  sessionSettingsInputSchema,
  setSessionTitleInputSchema,
  storeDelegationFramesInputSchema,
} from "./schemas.js";

export const sessionsRouter = t.router({
  list: t.procedure
    .input(sessionListInputSchema)
    .query(({ ctx, input }) => ctx.sessions.list(input)),

  history: t.procedure
    .input(sessionHistoryInputSchema)
    .query(({ ctx, input }) =>
      ctx.sessions.history(
        input.sessionId,
        input.tail !== undefined ? { tail: input.tail } : undefined,
      ),
    ),

  setTitle: t.procedure
    .input(setSessionTitleInputSchema)
    .mutation(async ({ ctx, input }) => {
      if (!(await ctx.sessions.setTitle(input)))
        throw new TRPCError({ code: "NOT_FOUND", message: "no such session" });
    }),

  settings: t.procedure
    .input(sessionSettingsInputSchema)
    .query(async ({ ctx, input }) => {
      const context = await ctx.sessions.settings(input);
      if (context === null)
        throw new TRPCError({ code: "NOT_FOUND", message: "no such session" });
      return context;
    }),
  byRef: t.procedure
    .input(sessionByRefInputSchema)
    .query(async ({ ctx, input }) => ({
      sessionId: await ctx.sessions.byRef(input.ref),
    })),

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
