import { TRPCError } from "@trpc/server";
import { t } from "../../trpc.js";
import { termsAcceptInputSchema } from "./schemas.js";
import type { StaleAcceptance } from "./types.js";

export const termsRouter = t.router({
  current: t.procedure.query(({ ctx }) => ctx.terms.current()),

  latestAcceptance: t.procedure.query(({ ctx }) =>
    ctx.terms.latestAcceptance(ctx.user.sub),
  ),

  accept: t.procedure
    .input(termsAcceptInputSchema)
    .mutation(async ({ ctx, input }) => {
      const current = ctx.terms.current();
      if (input.version !== current.version) {
        const stale: StaleAcceptance = {
          error: "terms_stale",
          currentVersion: current.version,
          currentHash: current.hash,
        };
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "terms_stale",
          cause: stale,
        });
      }
      await ctx.terms.accept(ctx.user.sub, input.version);
    }),
});
