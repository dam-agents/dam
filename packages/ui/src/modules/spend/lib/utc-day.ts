const DAY_MS = 86_400_000;

export interface DayRange {
  from: string;
  to: string;
}

export function utcDayOf(at: Date): string {
  return at.toISOString().slice(0, 10);
}

function timeOf(day: string): number {
  return Date.parse(`${day}T00:00:00Z`);
}

export function isUtcDay(text: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
  const time = timeOf(text);
  return !Number.isNaN(time) && utcDayOf(new Date(time)) === text;
}

export function addDays(day: string, days: number): string {
  return utcDayOf(new Date(timeOf(day) + days * DAY_MS));
}

function daysBetween(from: string, to: string): number {
  return Math.round((timeOf(to) - timeOf(from)) / DAY_MS);
}

export function daysInRange({ from, to }: DayRange): number {
  return daysBetween(from, to) + 1;
}

export function eachDay(range: DayRange): string[] {
  return Array.from({ length: daysInRange(range) }, (_, i) =>
    addDays(range.from, i),
  );
}

export function mondayOf(day: string): string {
  const weekday = (new Date(timeOf(day)).getUTCDay() + 6) % 7;
  return addDays(day, -weekday);
}

export function monthStartOf(day: string): string {
  return `${day.slice(0, 8)}01`;
}

export function addMonths(day: string, months: number): string {
  const at = new Date(timeOf(monthStartOf(day)));
  at.setUTCMonth(at.getUTCMonth() + months);
  return utcDayOf(at);
}

export function monthEndOf(day: string): string {
  return addDays(addMonths(day, 1), -1);
}

export function isoWeekOf(day: string): number {
  const thursday = addDays(mondayOf(day), 3);
  const firstThursday = addDays(mondayOf(`${thursday.slice(0, 4)}-01-04`), 3);
  return daysBetween(firstThursday, thursday) / 7 + 1;
}
