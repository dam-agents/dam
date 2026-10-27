import type { SpendByDay } from "api-server-api";

import { formatDate } from "@/lib/format-time";

export const monthStart = (base: Date, offset: number) =>
  new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + offset, 1));

export const monthLabel = (month: Date) =>
  formatDate(month, { month: "long", year: "numeric", timeZone: "UTC" });

const pad = (n: number) => String(n).padStart(2, "0");

const yearMonth = (month: Date) =>
  `${month.getUTCFullYear()}-${pad(month.getUTCMonth() + 1)}`;

const daysIn = (month: Date) =>
  new Date(
    Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + 1, 0),
  ).getUTCDate();

export function monthRange(month: Date): {
  from: string;
  to: string;
  isCurrentMonth: boolean;
} {
  return {
    from: `${yearMonth(month)}-01`,
    to: `${yearMonth(month)}-${pad(daysIn(month))}`,
    isCurrentMonth: month >= monthStart(new Date(), 0),
  };
}

export function fillMonthDays(
  month: Date,
  isCurrentMonth: boolean,
  rows: SpendByDay[] | undefined,
): SpendByDay[] {
  const byDay = new Map((rows ?? []).map((r) => [r.day, r.costUsd]));
  const lastDay = isCurrentMonth ? new Date().getUTCDate() : daysIn(month);
  const days: SpendByDay[] = [];
  for (let d = 1; d <= lastDay; d++) {
    const day = `${yearMonth(month)}-${pad(d)}`;
    days.push({ day, costUsd: byDay.get(day) ?? 0 });
  }
  return days;
}
