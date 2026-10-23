import { TRPCError } from "@trpc/server";
import { t } from "../../trpc.js";
import {
  processKeyInputSchema,
  setKeepInputSchema,
  setStartupItemEnabledInputSchema,
  startupItemInputSchema,
} from "./schemas.js";
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
const notRunning = () => "This process is no longer running.";
const noStartupItem = (id: string) => `No Startup Item ${id}.`;

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

  applyPendingRestart: t.procedure.mutation(async ({ ctx }) => {
    const result = await ctx.processes.applyPendingRestart();
    if (!result.ok)
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "No change is waiting for a restart.",
      });
  }),

  restartStartupItem: t.procedure
    .input(startupItemInputSchema)
    .mutation(async ({ ctx, input }) => {
      const result = await ctx.processes.restartStartupItem(input.id);
      if (!result.ok) throw toTrpcError(result.error, noStartupItem);
    }),

  stopStartupItem: t.procedure
    .input(startupItemInputSchema)
    .mutation(async ({ ctx, input }) => {
      const result = await ctx.processes.stopStartupItem(input.id);
      if (!result.ok) throw toTrpcError(result.error, noStartupItem);
    }),

  setStartupItemEnabled: t.procedure
    .input(setStartupItemEnabledInputSchema)
    .mutation(async ({ ctx, input }) => {
      const result = await ctx.processes.setStartupItemEnabled(
        input.id,
        input.enabled,
      );
      if (!result.ok) throw toTrpcError(result.error, noStartupItem);
    }),

  removeStartupItem: t.procedure
    .input(startupItemInputSchema)
    .mutation(async ({ ctx, input }) => {
      const result = await ctx.processes.removeStartupItem(input.id);
      if (!result.ok) throw toTrpcError(result.error, noStartupItem);
    }),
});
