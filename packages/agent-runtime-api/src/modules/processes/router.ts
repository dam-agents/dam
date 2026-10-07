import { TRPCError } from "@trpc/server";
import { t } from "../../trpc.js";
import { processKeyInputSchema, setKeepInputSchema } from "./schemas.js";
import type { ProcessesDomainError } from "./types.js";

function toTrpcError(
  error: ProcessesDomainError,
  notFound: (key: string) => string,
): TRPCError {
  switch (error.kind) {
    case "NotFound":
      return new TRPCError({ code: "NOT_FOUND", message: notFound(error.key) });
    case "NotAllowed":
      return new TRPCError({ code: "BAD_REQUEST", message: error.message });
  }
}

const noOutput = (key: string) => `no output for process ${key}`;
const notRunning = (key: string) => `no running process ${key}`;

export const processesRouter = t.router({
  list: t.procedure.query(({ ctx }) => ctx.processes.list()),

  watch: t.procedure.subscription(async function* ({ ctx, signal }) {
    for await (const notice of ctx.processes.watch(signal)) yield notice;
  }),

  output: t.procedure
    .input(processKeyInputSchema)
    .query(async ({ ctx, input }) => {
      const result = await ctx.processes.output(input.key);
      if (!result.ok) throw toTrpcError(result.error, noOutput);
      return result.value;
    }),

  setKeep: t.procedure
    .input(setKeepInputSchema)
    .mutation(async ({ ctx, input }) => {
      const result = await ctx.processes.setKeep(input.key, input.keepsAwake);
      if (!result.ok) throw toTrpcError(result.error, notRunning);
    }),

  stop: t.procedure
    .input(processKeyInputSchema)
    .mutation(async ({ ctx, input }) => {
      const result = await ctx.processes.stop(input.key);
      if (!result.ok) throw toTrpcError(result.error, notRunning);
    }),
});
