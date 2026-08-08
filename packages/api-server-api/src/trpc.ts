import { initTRPC } from "@trpc/server";
import type { ApiContext } from "./context.js";
import { scanFailureSchema } from "./modules/skills/schemas.js";
import { withTrpcTelemetry } from "./trpc-telemetry.js";

/** tRPC strips `cause` from the wire envelope, so a service that reached a
 *  user-facing verdict attaches it there and this lifts it into `data`. The
 *  client uses its presence to tell a verdict apart from a transport failure
 *  that never reached the server at all. */
function extractScanFailure(cause: unknown): unknown {
  if (!cause || typeof cause !== "object" || !("scanFailure" in cause)) return;
  const parsed = scanFailureSchema.safeParse(
    (cause as { scanFailure: unknown }).scanFailure,
  );
  return parsed.success ? parsed.data : undefined;
}

const tBase = initTRPC.context<ApiContext>().create({
  errorFormatter: ({ shape, error }) => {
    const scanFailure = extractScanFailure(error.cause);
    return {
      ...shape,
      data: { ...shape.data, ...(scanFailure ? { scanFailure } : {}) },
    };
  },
});

// Telemetry rides the base procedure so every router — including the ones
// that bypass the auth-procedure builders — emits per-procedure spans and
// metrics. Outermost middleware: auth denials land in the outcome too.
export const t = {
  ...tBase,
  procedure: tBase.procedure.use(({ path, type, next }) =>
    withTrpcTelemetry(path, type, next),
  ),
};
