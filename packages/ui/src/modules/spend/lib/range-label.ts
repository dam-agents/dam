import type { DayRange } from "./utc-day.js";

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

interface DayParts {
  year: string;
  month: number;
  day: number;
}

function partsOf(day: string): DayParts {
  return {
    year: day.slice(0, 4),
    month: Number(day.slice(5, 7)) - 1,
    day: Number(day.slice(8, 10)),
  };
}

export function formatDayMonth(day: string): string {
  const parts = partsOf(day);
  return `${parts.day} ${MONTHS[parts.month]}`;
}

export function formatDay(day: string): string {
  return `${formatDayMonth(day)} ${partsOf(day).year}`;
}

export function formatMonth(day: string): string {
  const parts = partsOf(day);
  return `${MONTH_NAMES[parts.month]} ${parts.year}`;
}

export function formatRange({ from, to }: DayRange): string {
  if (from === to) return formatDay(from);
  const start = partsOf(from);
  const end = partsOf(to);
  if (start.year !== end.year) return `${formatDay(from)} – ${formatDay(to)}`;
  if (start.month !== end.month) {
    return `${formatDayMonth(from)} – ${formatDay(to)}`;
  }
  return `${start.day}–${formatDay(to)}`;
}

export function measuredRange(
  range: DayRange,
  startDay: string,
): DayRange | null {
  if (range.to < startDay) return null;
  return { from: range.from < startDay ? startDay : range.from, to: range.to };
}

export interface ShownRange {
  range: DayRange;
  cutAtStart: boolean;
  soFar: boolean;
}

export function shownRange(
  range: DayRange,
  startDay: string,
  today: string,
): ShownRange | null {
  const measured = measuredRange(range, startDay);
  if (!measured) return null;
  const soFar = measured.from <= today && today <= measured.to;
  return {
    range: { from: measured.from, to: soFar ? today : measured.to },
    cutAtStart: measured.from !== range.from,
    soFar,
  };
}
