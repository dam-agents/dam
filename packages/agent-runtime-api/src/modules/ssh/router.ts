import { TRPCError } from "@trpc/server";
import { t } from "../../trpc.js";
import type { SshDomainError } from "./types.js";
import { sshAuthorizeKeyInputSchema } from "./schemas.js";

const statusOf = (error: SshDomainError) => {
  switch (error.kind) {
    case "Invalid":
      return "BAD_REQUEST";
    case "Unavailable":
      return "INTERNAL_SERVER_ERROR";
  }
};

export const sshRouter = t.router({
  authorizeKey: t.procedure
    .input(sshAuthorizeKeyInputSchema)
    .mutation(async ({ ctx, input }) => {
      const result = await ctx.ssh.authorizeKey(input.publicKey);
      if (!result.ok)
        throw new TRPCError({
          code: statusOf(result.error),
          message: result.error.reason,
        });
      return { ok: true as const };
    }),
});
