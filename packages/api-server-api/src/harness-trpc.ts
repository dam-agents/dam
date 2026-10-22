import { initTRPC, TRPCError } from "@trpc/server";
import type { HarnessContext } from "./harness-context.js";
import { hasOversizedArray, OVERSIZED_ARRAY_MESSAGE } from "./input-bounds.js";
import { withTrpcTelemetry } from "./trpc-telemetry.js";

const harnessTBase = initTRPC.context<HarnessContext>().create();

export const harnessT = {
  ...harnessTBase,
  procedure: harnessTBase.procedure
    .use(({ path, type, next }) => withTrpcTelemetry(path, type, next))
    .use(async ({ getRawInput, next }) => {
      if (hasOversizedArray(await getRawInput())) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: OVERSIZED_ARRAY_MESSAGE,
        });
      }
      return next();
    }),
};
