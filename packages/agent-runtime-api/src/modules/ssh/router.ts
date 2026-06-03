import { TRPCError } from "@trpc/server";
import { protectedProcedure, t } from "../../trpc.js";
import { sshAuthorizeKeyInputSchema } from "./schemas.js";
import type { SshDomainError } from "./types.js";

function toTrpcError(error: SshDomainError): TRPCError {
  switch (error.kind) {
    case "Invalid":
      return new TRPCError({ code: "BAD_REQUEST", message: error.reason });
  }
}

export const sshRouter = t.router({
  authorizeKey: protectedProcedure
    .input(sshAuthorizeKeyInputSchema)
    .mutation(async ({ ctx, input }) => {
      const result = await ctx.ssh.authorizeKey(input.publicKey);
      if (!result.ok) throw toTrpcError(result.error);
      return { ok: true as const };
    }),
});
