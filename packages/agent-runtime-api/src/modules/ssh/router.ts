import { TRPCError } from "@trpc/server";
import { t } from "../../trpc.js";
import { sshAuthorizeKeyInputSchema } from "./schemas.js";

export const sshRouter = t.router({
  authorizeKey: t.procedure
    .input(sshAuthorizeKeyInputSchema)
    .mutation(async ({ ctx, input }) => {
      const result = await ctx.ssh.authorizeKey(input.publicKey);
      if (!result.ok)
        throw new TRPCError({
          code:
            result.error.kind === "Invalid"
              ? "BAD_REQUEST"
              : "INTERNAL_SERVER_ERROR",
          message: result.error.reason,
        });
      return { ok: true as const };
    }),
});
