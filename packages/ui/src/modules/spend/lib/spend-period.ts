import { SPEND_DAILY_MAX_DAYS } from "api-server-api";
import { match } from "ts-pattern";

import {
  addDays,
  addMonths,
  type DayRange,
  daysInRange,
  isUtcDay,
  mondayOf,
  monthEndOf,
  monthStartOf,
} from "./utc-day.js";

export const PRESET_PERIODS = [
  "today",
  "yesterday",
  "this-week",
  "last-week",
  "this-month",
  "last-month",
] as const;

export type PresetPeriod = (typeof PRESET_PERIODS)[number];

export type SpendPeriod = PresetPeriod | DayRange;

export const HOME_PERIODS: readonly PresetPeriod[] = [
  "today",
  "this-month",
  "last-month",
];

export const DEFAULT_PERIOD: PresetPeriod = "this-month";

function weekOf(day: string): DayRange {
  const from = mondayOf(day);
  return { from, to: addDays(from, 6) };
}

function monthOf(day: string): DayRange {
  return { from: monthStartOf(day), to: monthEndOf(day) };
}

const PRESET_RANGES: Readonly<
  Record<PresetPeriod, (today: string) => DayRange>
> = {
  today: (today) => ({ from: today, to: today }),
  yesterday: (today) => {
    const day = addDays(today, -1);
    return { from: day, to: day };
  },
  "this-week": (today) => weekOf(today),
  "last-week": (today) => weekOf(addDays(today, -7)),
  "this-month": (today) => monthOf(today),
  "last-month": (today) => monthOf(addMonths(today, -1)),
};

export function isPresetPeriod(period: SpendPeriod): period is PresetPeriod {
  return typeof period === "string";
}

export function rangeOf(period: SpendPeriod, today: string): DayRange {
  return isPresetPeriod(period) ? PRESET_RANGES[period](today) : period;
}

export function periodOfRange(range: DayRange, today: string): SpendPeriod {
  return (
    PRESET_PERIODS.find((preset) => {
      const presetRange = PRESET_RANGES[preset](today);
      return presetRange.from === range.from && presetRange.to === range.to;
    }) ?? range
  );
}

type RangeKind = "day" | "week" | "month" | "custom";

function kindOf({ from, to }: DayRange): RangeKind {
  if (from === to) return "day";
  if (from === mondayOf(from) && to === addDays(from, 6)) return "week";
  if (from === monthStartOf(from) && to === monthEndOf(from)) return "month";
  return "custom";
}

function shift(range: DayRange, days: number): DayRange {
  return { from: addDays(range.from, days), to: addDays(range.to, days) };
}

export function stepPeriod(
  period: SpendPeriod,
  direction: 1 | -1,
  today: string,
): SpendPeriod {
  const range = rangeOf(period, today);
  const stepped = match(kindOf(range))
    .with("day", () => shift(range, direction))
    .with("week", () => shift(range, 7 * direction))
    .with("month", () => monthOf(addMonths(range.from, direction)))
    .with("custom", () => shift(range, daysInRange(range) * direction))
    .exhaustive();
  return periodOfRange(stepped, today);
}

const RANGE_SEPARATOR = "..";

export function parsePeriod(
  text: string | null | undefined,
): SpendPeriod | null {
  if (!text) return null;
  const preset = PRESET_PERIODS.find((id) => id === text);
  if (preset) return preset;
  const [from, to, ...rest] = text.split(RANGE_SEPARATOR);
  if (rest.length > 0 || !from || !to || !isUtcDay(from) || !isUtcDay(to)) {
    return null;
  }
  const days = daysInRange({ from, to });
  return days >= 1 && days <= SPEND_DAILY_MAX_DAYS ? { from, to } : null;
}

export function formatPeriod(period: SpendPeriod): string {
  return isPresetPeriod(period)
    ? period
    : `${period.from}${RANGE_SEPARATOR}${period.to}`;
}
