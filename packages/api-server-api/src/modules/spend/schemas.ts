import { z } from "zod";

export const SPEND_DAILY_MAX_DAYS = 366;

export const MICROS_PER_UNIT = 1_000_000;

export const PLATFORM_REFUSAL_HEADER = "x-platform-refusal";

export const SPEND_LIMIT_MAX_MICROS = 1_000_000 * MICROS_PER_UNIT;

export const spendUnitSchema = z.enum(["usd", "usd_list", "bobcoin", "free"]);

const utcDaySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "a UTC day must look like 2026-10-13")
  .refine(
    (day) => {
      const time = Date.parse(`${day}T00:00:00Z`);
      return (
        !Number.isNaN(time) && new Date(time).toISOString().startsWith(day)
      );
    },
    { message: "not a valid UTC day" },
  );

export const spendDailyInputSchema = z
  .object({
    agentId: z.string().min(1).optional(),
    from: utcDaySchema,
    to: utcDaySchema,
  })
  .superRefine((input, ctx) => {
    const days =
      (Date.parse(`${input.to}T00:00:00Z`) -
        Date.parse(`${input.from}T00:00:00Z`)) /
        86_400_000 +
      1;
    if (days < 1) {
      ctx.addIssue({
        code: "custom",
        path: ["from"],
        message: "from must be on or before to",
      });
    } else if (days > SPEND_DAILY_MAX_DAYS) {
      ctx.addIssue({
        code: "custom",
        path: ["from"],
        message: `at most ${SPEND_DAILY_MAX_DAYS} days`,
      });
    }
  });

export const spendBreakdownInputSchema = spendDailyInputSchema;

export const SPEND_SESSIONS_MAX = 200;
export const SPEND_SESSIONS_DEFAULT_LIMIT = 50;

export const spendSessionsInputSchema = z
  .object({
    agentId: z.string().min(1),
    from: utcDaySchema.optional(),
    to: utcDaySchema.optional(),
    sessionIds: z.array(z.string().min(1)).max(SPEND_SESSIONS_MAX).optional(),
    limit: z.number().int().min(1).max(SPEND_SESSIONS_MAX).optional(),
  })
  .superRefine((input, ctx) => {
    if (input.from && input.to && input.from > input.to) {
      ctx.addIssue({
        code: "custom",
        path: ["from"],
        message: "from must be on or before to",
      });
    }
  });

export const spendLimitScopeSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("agent"), agentId: z.string().min(1) }),
  z.object({ kind: z.literal("owner") }),
  z.object({
    kind: z.literal("connection"),
    agentId: z.string().min(1),
    connectionId: z.string().min(1),
  }),
]);

export const spendLimitAmountSchema = z
  .number()
  .int()
  .nonnegative()
  .max(SPEND_LIMIT_MAX_MICROS);

function decimalToMicros(text: string): number {
  const [whole = "0", fraction = ""] = text.split(".");
  return Number(whole) * MICROS_PER_UNIT + Number(fraction.padEnd(6, "0"));
}

export const spendLimitAmountTextSchema = z
  .string()
  .trim()
  .regex(
    /^\d+(\.\d{1,6})?$/,
    "an amount looks like 10 or 0.25, with at most 6 decimals",
  )
  .transform(decimalToMicros)
  .pipe(spendLimitAmountSchema);

export const spendCeilingUsdTextSchema = z
  .string()
  .trim()
  .regex(
    /^\d{1,7}(\.\d{1,2})?$/,
    "a ceiling looks like 50 or 12.50: dollars with at most 7 digits and 2 decimals",
  )
  .transform(decimalToMicros);

export const spendStatusInputSchema = z
  .object({ agentId: z.string().min(1).optional() })
  .optional();

export const spendSetLimitInputSchema = z.object({
  scope: spendLimitScopeSchema,
  amountMicros: spendLimitAmountSchema.nullable(),
});

export const spendLimitStateSchema = z.enum(["ok", "warn", "reached"]);

export const spendCeilingSourceSchema = z.enum(["default", "UserSpendLimit"]);
