import { initTRPC } from "@trpc/server";
import type { HarnessContext } from "./harness-context.js";
import { withTrpcTelemetry } from "./trpc-telemetry.js";

const harnessTBase = initTRPC.context<HarnessContext>().create();

// Same base-procedure telemetry as ./trpc.ts, for the harness-facing instance.
export const harnessT = {
  ...harnessTBase,
  procedure: harnessTBase.procedure.use(({ path, type, next }) =>
    withTrpcTelemetry(path, type, next),
  ),
};
