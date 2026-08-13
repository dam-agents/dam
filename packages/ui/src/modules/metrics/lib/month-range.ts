import type { SpendByDay } from "api-server-api";

import { formatDate } from "@/lib/format-time";

export const monthStart = (base: Date, offset: number) =>
  new Date(base.getFullYear(), base.getMonth() + offset, 1);

export const monthLabel = (month: Date) =>
  formatDate(month, { month: "long", year: "numeric" });

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
