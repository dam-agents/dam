import { initTRPC, TRPCError } from "@trpc/server";
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

function isTermsStaleCause(cause: unknown): boolean {
  return (
    !!cause &&
    typeof cause === "object" &&
    "termsStale" in cause &&
    (cause as { termsStale: unknown }).termsStale === true
  );
}

const tBase = initTRPC.context<ApiContext>().create({
  errorFormatter: ({ shape, error }) => {
    const scanFailure = extractScanFailure(error.cause);
    return {
      ...shape,
      data: {
        ...shape.data,
        ...(scanFailure ? { scanFailure } : {}),
        ...(isTermsStaleCause(error.cause)
          ? { termsStale: true as const }
          : {}),
      },
    };
  },
});

const termsProven = new WeakSet<ApiContext>();

export function markTermsProven(ctx: ApiContext): void {
  termsProven.add(ctx);
}

const requireTermsAccepted = tBase.middleware(async ({ ctx, path, next }) => {
  if (path.startsWith("terms.")) return next();
  if (!termsProven.has(ctx)) {
    if (!(await ctx.terms.isAccepted(ctx.user.sub))) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "terms not accepted",
        cause: { termsStale: true },
      });
    }
    termsProven.add(ctx);
  }
  return next();
});

export const t = {
  ...tBase,
  procedure: tBase.procedure
    .use(({ path, type, next }) => withTrpcTelemetry(path, type, next))
    .use(requireTermsAccepted),
};
