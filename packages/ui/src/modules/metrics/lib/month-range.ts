import type { SpendByDay } from "api-server-api";

import { formatDate } from "@/lib/format-time";

// Month boundaries are computed in the browser's timezone; the API takes the
// resulting instants, so "calendar month" means the user's wall-clock month.
export const monthStart = (base: Date, offset: number) =>
  new Date(base.getFullYear(), base.getMonth() + offset, 1);

export const monthLabel = (month: Date) =>
  formatDate(month, { month: "long", year: "numeric" });

/** The half-open `[from, to)` instant range a spend read takes for one calendar
 *  month, plus whether that month is the current one. Both Usage surfaces derive
 *  their query inputs here so neither reasons about calendars on its own. */
export function monthRange(month: Date): {
  from: string;
  to: string;
  isCurrentMonth: boolean;
} {
  return {
    from: month.toISOString(),
    to: monthStart(month, 1).toISOString(),
    isCurrentMonth: month >= monthStart(new Date(), 0),
  };
}

// The browser owns calendar semantics: from the sparse per-day rows the server
// returns, build the full day list for the selected month, zero-filling days
// with no spend. For the current month we stop at today so there are no empty
// future columns. Keys are local `YYYY-MM-DD`, matching the server's buckets.
const pad = (n: number) => String(n).padStart(2, "0");
export function fillMonthDays(
  month: Date,
  isCurrentMonth: boolean,
  rows: SpendByDay[] | undefined,
): SpendByDay[] {
  const byDay = new Map((rows ?? []).map((r) => [r.day, r.costUsd]));
  const year = month.getFullYear();
  const m = month.getMonth();
  const daysInMonth = new Date(year, m + 1, 0).getDate();
  const lastDay = isCurrentMonth ? new Date().getDate() : daysInMonth;
  const days: SpendByDay[] = [];
  for (let d = 1; d <= lastDay; d++) {
    const day = `${year}-${pad(m + 1)}-${pad(d)}`;
    days.push({ day, costUsd: byDay.get(day) ?? 0 });
  }
  return days;
}
