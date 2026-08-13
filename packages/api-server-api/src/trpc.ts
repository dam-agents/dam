import { initTRPC } from "@trpc/server";
import type { ApiContext } from "./context.js";
import { scanFailureSchema } from "./modules/skills/schemas.js";
import { withTrpcTelemetry } from "./trpc-telemetry.js";

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

export const t = {
  ...tBase,
  procedure: tBase.procedure.use(({ path, type, next }) =>
    withTrpcTelemetry(path, type, next),
  ),
};
