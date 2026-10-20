import type { SpendBreakdown } from "api-server-api";

import { formatDayMonth } from "./range-label.js";
import {
  type DayRange,
  daysInRange,
  eachDay,
  isoWeekOf,
  mondayOf,
} from "./utc-day.js";

const WEEKLY_ABOVE_DAYS = 62;
const MAX_WEEK_LABELS = 14;

export type BucketState = "measured" | "not-measured" | "future";

export interface SpendBucket {
  key: string;
  name: string;
  axisLabel: string;
  paidMicros: number;
  planMicros: number;
  state: BucketState;
}

function dayState(day: string, startDay: string, today: string): BucketState {
  if (day < startDay) return "not-measured";
  if (day > today) return "future";
  return "measured";
}

function weekState(states: readonly BucketState[]): BucketState {
  if (states.includes("measured")) return "measured";
  return states.every((state) => state === "future")
    ? "future"
    : "not-measured";
}

export function spendBuckets(input: {
  range: DayRange;
  byDay: SpendBreakdown["byDay"];
  startDay: string;
  today: string;
}): SpendBucket[] {
  const paid = new Map<string, number>();
  const plan = new Map<string, number>();
  for (const row of input.byDay) {
    if (row.unit === "usd") paid.set(row.day, row.costMicros);
    if (row.unit === "usd_list") plan.set(row.day, row.costMicros);
  }
  const days = eachDay(input.range).map((day) => ({
    day,
    paidMicros: paid.get(day) ?? 0,
    planMicros: plan.get(day) ?? 0,
    state: dayState(day, input.startDay, input.today),
  }));
  if (daysInRange(input.range) <= WEEKLY_ABOVE_DAYS) {
    return days.map(({ day, ...amounts }) => {
      const dayNum = Number(day.slice(8, 10));
      return {
        key: day,
        name: formatDayMonth(day),
        axisLabel: dayNum % 2 === 1 ? String(dayNum) : "",
        ...amounts,
      };
    });
  }
  const weeks = new Map<string, typeof days>();
  for (const entry of days) {
    const monday = mondayOf(entry.day);
    weeks.set(monday, [...(weeks.get(monday) ?? []), entry]);
  }
  const every = Math.ceil(weeks.size / MAX_WEEK_LABELS);
  return [...weeks].map(([monday, entries], i) => ({
    key: monday,
    name: `W${isoWeekOf(monday)}`,
    axisLabel: i % every === 0 ? `W${isoWeekOf(monday)}` : "",
    paidMicros: entries.reduce((sum, e) => sum + e.paidMicros, 0),
    planMicros: entries.reduce((sum, e) => sum + e.planMicros, 0),
    state: weekState(entries.map((e) => e.state)),
  }));
}
