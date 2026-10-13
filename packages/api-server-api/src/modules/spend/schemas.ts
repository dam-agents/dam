import { z } from "zod";

export const SPEND_DAILY_MAX_DAYS = 92;

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
