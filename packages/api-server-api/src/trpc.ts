import { initTRPC, TRPCError } from "@trpc/server";
import type { ApiContext } from "./context.js";
import { scanFailureSchema } from "./modules/skills/schemas.js";
import { PRE_TERMS_PROCEDURES } from "./modules/terms/pre-terms-procedures.js";
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

const PG_INVALID_TEXT_REPRESENTATION = "22P02";
const PG_CHARACTER_NOT_IN_REPERTOIRE = "22021";
const PG_UNTRANSLATABLE_CHARACTER = "22P05";
const PG_UNIQUE_VIOLATION = "23505";
const PG_ERRORS: Record<string, { code: TRPCError["code"]; message: string }> =
  {
    [PG_INVALID_TEXT_REPRESENTATION]: {
      code: "BAD_REQUEST",
      message: "malformed identifier",
    },
    [PG_CHARACTER_NOT_IN_REPERTOIRE]: {
      code: "BAD_REQUEST",
      message: "unsupported character in input",
    },
    [PG_UNTRANSLATABLE_CHARACTER]: {
      code: "BAD_REQUEST",
      message: "unsupported character in input",
    },
    [PG_UNIQUE_VIOLATION]: { code: "CONFLICT", message: "already exists" },
  };

function pgErrorCode(err: unknown): string | undefined {
  let e = err;
  for (let depth = 0; depth < 3 && e instanceof Error; depth++) {
    if ("code" in e && typeof e.code === "string") return e.code;
    e = (e as { cause?: unknown }).cause;
  }
  return undefined;
}

const REDACTED_MESSAGES: Partial<Record<TRPCError["code"], string>> = {
  INTERNAL_SERVER_ERROR: "internal server error",
  UNSUPPORTED_MEDIA_TYPE: "unsupported content-type",
};

const tBase = initTRPC.context<ApiContext>().create({
  errorFormatter: ({ shape, error }) => {
    const scanFailure = extractScanFailure(error.cause);
    return {
      ...shape,
      message: REDACTED_MESSAGES[error.code] ?? shape.message,
      data: {
        ...shape.data,
        stack: undefined,
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

const mapPgErrors = tBase.middleware(async ({ next }) => {
  const result = await next();
  if (result.ok) return result;
  const mapped = PG_ERRORS[pgErrorCode(result.error.cause) ?? ""];
  if (!mapped) return result;
  throw new TRPCError({ ...mapped, cause: result.error.cause });
});

const requireTermsAccepted = tBase.middleware(async ({ ctx, path, next }) => {
  if (PRE_TERMS_PROCEDURES.has(path)) return next();
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
    .use(mapPgErrors)
    .use(requireTermsAccepted),
};
