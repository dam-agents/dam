import { TRPCError } from "@trpc/server";
import { t } from "../../trpc.js";
import { processKeyInputSchema } from "./schemas.js";
import type { ProcessesDomainError } from "./types.js";

function toTrpcError(error: ProcessesDomainError): TRPCError {
  return new TRPCError({
    code: "NOT_FOUND",
    message: `no output for process ${error.key}`,
  });
}

export const processesRouter = t.router({
  list: t.procedure.query(({ ctx }) => ctx.processes.list()),

  watch: t.procedure.subscription(async function* ({ ctx, signal }) {
    for await (const notice of ctx.processes.watch(signal)) yield notice;
  }),

  output: t.procedure
    .input(processKeyInputSchema)
    .query(async ({ ctx, input }) => {
      const result = await ctx.processes.output(input.key);
      if (!result.ok) throw toTrpcError(result.error);
      return result.value;
    }),
});
