import { TRPCError } from "@trpc/server";
import { t } from "../../trpc.js";
import {
  changeSetDiffInputSchema,
  changeSetListInputSchema,
} from "./schemas.js";
import type { ChangesDomainError } from "./types.js";

function toTrpcError(error: ChangesDomainError): TRPCError {
  switch (error.kind) {
    case "NotFound":
      return new TRPCError({
        code: "NOT_FOUND",
        message: `no change set at ${error.path}`,
      });
    case "GitFailed":
      return new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: error.message,
      });
  }
}

export const changesRouter = t.router({
  list: t.procedure
    .input(changeSetListInputSchema)
    .query(({ ctx, input }) => ctx.changes.list(input.sessionId)),

  diff: t.procedure
    .input(changeSetDiffInputSchema)
    .query(async ({ ctx, input }) => {
      const result = await ctx.changes.diff(input.path, input.compare);
      if (!result.ok) throw toTrpcError(result.error);
      return result.value;
    }),

  watch: t.procedure.subscription(async function* ({ ctx, signal }) {
    for await (const notice of ctx.changes.watch(signal)) yield notice;
  }),
});
