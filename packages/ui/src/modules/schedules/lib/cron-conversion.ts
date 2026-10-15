import { CronExpressionParser, type CronFieldCollection } from "cron-parser";

import { CRON_TIMEZONE } from "./schedule-format.js";

export interface ExactCronConversion {
  kind: "exact";
  rrule: string;
  from: Date;
  cronRuns: Date[];
}

export type CronConversion =
  ExactCronConversion | { kind: "inexact"; reason: string };

export const PREVIEW_RUNS = 5;
const CRON_TO_BYDAY = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];
const MONDAY_FIRST = [1, 2, 3, 4, 5, 6, 0];
const NAMES = /[a-z]{3}/gi;
const HASH_OR_NTH = /[#H]/i;

export function convertCron(
  cron: string,
  now: Date = new Date(),
): CronConversion {
  let expression: ReturnType<typeof CronExpressionParser.parse>;
  try {
    expression = CronExpressionParser.parse(cron, {
      currentDate: now,
      tz: CRON_TIMEZONE,
    });
  } catch (e) {
    return {
      kind: "inexact",
      reason: `It can't be read: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
  const reason = inexactReason(cron, expression.fields);
  if (reason) return { kind: "inexact", reason };
  return {
    kind: "exact",
    rrule: toRRule(expression.fields),
    from: now,
    cronRuns: expression.take(PREVIEW_RUNS).map((d) => d.toDate()),
  };
}

export function cronProblem(cron: string): string | null {
  try {
    CronExpressionParser.parse(cron, { tz: CRON_TIMEZONE });
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

export function nextCronRuns(cron: string, from: Date, count: number): Date[] {
  try {
    return CronExpressionParser.parse(cron, {
      currentDate: from,
      tz: CRON_TIMEZONE,
    })
      .take(count)
      .map((d) => d.toDate());
  } catch {
    return [];
  }
}

function inexactReason(
  cron: string,
  fields: CronFieldCollection,
): string | null {
  const trimmed = cron.trim();
  if (!trimmed.startsWith("@") && HASH_OR_NTH.test(trimmed.replace(NAMES, "")))
    return "It uses # or H, which the newer format has no exact match for.";
  if (
    [...fields.dayOfMonth.values, ...fields.dayOfWeek.values].some(
      (v) => typeof v !== "number",
    )
  )
    return "It uses L or W, which the newer format has no exact match for.";
  if (fields.second.values.some((s) => s !== 0))
    return "It runs at seconds past the minute, and the newer format runs on whole minutes only.";
  if (!fields.dayOfMonth.isWildcard && !fields.dayOfWeek.isWildcard)
    return "It names both days of the month and days of the week. Cron runs on either one, and the newer format needs both to match.";
  return null;
}

function toRRule(fields: CronFieldCollection): string {
  const parts = recurrence(
    numbers(fields.minute.values),
    numbers(fields.hour.values),
  );
  const days = new Set(
    numbers(fields.dayOfWeek.values).map((d) => (d === 7 ? 0 : d)),
  );
  if (days.size < 7)
    parts.push(
      `BYDAY=${MONDAY_FIRST.filter((d) => days.has(d))
        .map((d) => CRON_TO_BYDAY[d])
        .join(",")}`,
    );
  if (!fields.dayOfMonth.isWildcard)
    parts.push(`BYMONTHDAY=${numbers(fields.dayOfMonth.values).join(",")}`);
  const months = numbers(fields.month.values);
  if (months.length < 12) parts.push(`BYMONTH=${months.join(",")}`);
  return parts.join(";");
}

function recurrence(minutes: number[], hours: number[]): string[] {
  const everyHour = hours.length === 24;
  const minuteStep = evenStep(minutes, 60);
  if (everyHour && minuteStep)
    return ["FREQ=MINUTELY", `INTERVAL=${minuteStep}`];
  const hourStep = evenStep(hours, 24);
  if (minutes.length === 1 && minutes[0] === 0 && (everyHour || hourStep))
    return ["FREQ=HOURLY", `INTERVAL=${everyHour ? 1 : hourStep}`];
  if (everyHour)
    return ["FREQ=HOURLY", `BYMINUTE=${minutes.join(",")}`, "BYSECOND=0"];
  return [
    "FREQ=DAILY",
    `BYHOUR=${hours.join(",")}`,
    `BYMINUTE=${minutes.join(",")}`,
    "BYSECOND=0",
  ];
}

function evenStep(values: number[], period: number): number | null {
  if (values.length < 2 || values[0] !== 0) return null;
  const step = values[1] ?? 0;
  if (period % step !== 0 || values.length !== period / step) return null;
  return values.every((v, i) => v === i * step) ? step : null;
}

function numbers(values: readonly (number | string)[]): number[] {
  return values
    .filter((v): v is number => typeof v === "number")
    .sort((a, b) => a - b);
}
