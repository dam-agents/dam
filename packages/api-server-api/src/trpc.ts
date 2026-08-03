import { initTRPC } from "@trpc/server";
import type { ApiContext } from "./context.js";
import { withTrpcTelemetry } from "./trpc-telemetry.js";

const tBase = initTRPC.context<ApiContext>().create();

// Telemetry rides the base procedure so every router — including the ones
// that bypass the auth-procedure builders — emits per-procedure spans and
// metrics. Outermost middleware: auth denials land in the outcome too.
export const t = {
  ...tBase,
  procedure: tBase.procedure.use(({ path, type, next }) =>
    withTrpcTelemetry(path, type, next),
  ),
};
