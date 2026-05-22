import { TRPCError } from "@trpc/server";
import { protectedProcedure, t } from "../../trpc.js";
import { applyStateInputSchema, deliverSignalInputSchema } from "./schemas.js";
import type { RuntimeChannelDomainError } from "./types.js";

function toTrpcError(error: RuntimeChannelDomainError): TRPCError {
  switch (error.kind) {
    case "OlderVersion":
      return new TRPCError({
        code: "CONFLICT",
        message: `apply rejected: agent already at version ${error.currentVersion}`,
      });
    case "MissingCapability":
      return new TRPCError({
        code: "PRECONDITION_FAILED",
        message: `agent missing capabilities: ${error.missing.join(", ")}`,
      });
    case "ApplyFailed":
      return new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: error.reason,
      });
  }
}

/** Server → agent calls. Mounted under `runtime.v1` so a future v2 with
 *  incompatible payload shape can sit alongside without ambiguous
 *  version-in-payload semantics (see ADR-048 "Route-prefix versioning"). */
export const runtimeChannelRouter = t.router({
  v1: t.router({
    applyState: protectedProcedure
      .input(applyStateInputSchema)
      .mutation(async ({ ctx, input }) => {
        const result = await ctx.runtimeChannel.applyState(input.state);
        if (!result.ok) throw toTrpcError(result.error);
        return result.value;
      }),

    deliverSignal: protectedProcedure
      .input(deliverSignalInputSchema)
      .mutation(async ({ ctx, input }) => {
        const result = await ctx.runtimeChannel.deliverSignal(input.signal);
        if (!result.ok) throw toTrpcError(result.error);
        return result.value;
      }),
  }),
});
