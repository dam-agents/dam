import { CronExpressionParser } from "cron-parser";
import rrulePkg from "rrule";
import { hasVisibleOccurrence, isInQuietHours } from "api-server-api";
import type { QuietWindow, ScheduleSpec } from "api-server-api";

const { RRule } = rrulePkg;

export function validateCron(expr: string): void {
  CronExpressionParser.parse(expr);
}

export function validateRRule(expr: string): void {
  const rule = RRule.fromString(expr);
  if (!rule) throw new Error(`invalid rrule: ${expr}`);
}

export function validateTimezone(tz: string): void {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
  } catch {
    throw new Error(`invalid timezone: ${tz}`);
  }
}

export function validateHasVisibleOccurrence(
  rruleExpr: string,
  windows: QuietWindow[],
): void {
  if (!hasVisibleOccurrence(rruleExpr, windows)) {
    throw new Error(
      "quiet hours cover every scheduled occurrence — this schedule would never fire",
    );
  }
}

export function nextFireAt(spec: ScheduleSpec, from: Date): Date | null {
  if (spec.type === "cron") {
    try {
      const cron = CronExpressionParser.parse(spec.cron, {
        currentDate: from,
        tz: "UTC",
      });
      return cron.next().toDate();
    } catch {
      return null;
    }
  }
  const wallFrom = toWallClock(from, spec.timezone);
  wallFrom.setUTCSeconds(0, 0);
  const rule = new RRule({
    dtstart: wallFrom,
    ...RRule.parseString(spec.rrule),
  });
  const enabled = (spec.quietHours ?? []).filter((w) => w.enabled);
  let cursor = wallFrom;
  for (let i = 0; i < 1440; i++) {
    const next = rule.after(cursor, false);
    if (!next) return null;
    if (enabled.length === 0 || !isInQuietHours(next, enabled)) {
      return toInstant(next, spec.timezone);
    }
    cursor = next;
  }
  return null;
}

export function triggerExpiry(
  firedAt: Date,
  next: Date | null,
  ttlSec: number,
): Date {
  const byTtl = firedAt.getTime() + ttlSec * 1000;
  if (next === null || next.getTime() <= firedAt.getTime()) {
    return new Date(byTtl);
  }
  return new Date(Math.min(byTtl, next.getTime()));
}

function toWallClock(instant: Date, tz: string): Date {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(instant);
  const f: Record<string, number> = {};
  for (const p of parts) {
    if (p.type !== "literal") f[p.type] = Number(p.value);
  }
  return new Date(
    Date.UTC(f.year, f.month - 1, f.day, f.hour % 24, f.minute, f.second),
  );
}

function toInstant(wall: Date, tz: string): Date {
  const guess = wall.getTime() - tzOffsetMs(wall, tz);
  return new Date(wall.getTime() - tzOffsetMs(new Date(guess), tz));
}

function tzOffsetMs(instant: Date, tz: string): number {
  return toWallClock(instant, tz).getTime() - instant.getTime();
}
