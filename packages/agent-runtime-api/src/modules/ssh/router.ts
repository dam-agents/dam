import { TRPCError } from "@trpc/server";
import { protectedProcedure, t } from "../../trpc.js";
import { sshAuthorizeKeyInputSchema } from "./schemas.js";

export const sshRouter = t.router({
  authorizeKey: protectedProcedure
    .input(sshAuthorizeKeyInputSchema)
    .mutation(async ({ ctx, input }) => {
      const result = await ctx.ssh.authorizeKey(input.publicKey);
      if (!result.ok)
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: result.error.reason,
        });
      return { ok: true as const };
    }),
});
