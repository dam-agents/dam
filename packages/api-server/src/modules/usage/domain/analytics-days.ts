const MS_PER_DAY = 86_400_000;

export type DayNumber = number;

export function dayOf(at: Date): DayNumber {
  return Math.floor(at.getTime() / MS_PER_DAY);
}

export function dayFromIsoDate(isoDate: string): DayNumber {
  return Math.floor(Date.parse(`${isoDate}T00:00:00Z`) / MS_PER_DAY);
}

export function isoDateOf(day: DayNumber): string {
  return new Date(day * MS_PER_DAY).toISOString().slice(0, 10);
}

export function mondayOf(day: DayNumber): DayNumber {
  const sinceMonday = (((day + 3) % 7) + 7) % 7;
  return day - sinceMonday;
}

export function elapsedDays(from: Date, to: Date): number {
  return (to.getTime() - from.getTime()) / MS_PER_DAY;
}

export type DayWindow = { from: DayNumber; to: DayNumber };

export function rollingWindow(today: DayNumber, back: number): DayWindow {
  return { from: today - 7 * (back + 1), to: today - 7 * back };
}

export function lastCompleteWeekStart(today: DayNumber): DayNumber {
  return mondayOf(today) - 7;
}

export function latestEligibleCohortStart(today: DayNumber): DayNumber {
  return mondayOf(today - 14);
}

export function weekStartsEndingAt(
  lastStart: DayNumber,
  count: number,
): DayNumber[] {
  return Array.from({ length: count }, (_, i) => lastStart - 7 * (count - 1 - i));
}
