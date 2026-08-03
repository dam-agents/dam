import { CronExpressionParser } from "cron-parser";
import rrulePkg from "rrule";
import { hasVisibleOccurrence, isInQuietHours } from "api-server-api";
import type { QuietWindow, ScheduleSpec } from "api-server-api";

// rrule@2.8.1 ships CJS as its Node entry (`main`) with no `exports` map,
// so Node ESM can't pull named bindings directly — destructure the default.
const { RRule } = rrulePkg;

export function validateCron(expr: string): void {
  CronExpressionParser.parse(expr);
}

/**
 * Validate an RFC 5545 RRULE body (e.g. "FREQ=WEEKLY;BYDAY=MO,WE;BYHOUR=7").
 * Throws on parse errors. We call `rrulestr` with the raw body; rrule.js
 * accepts either a full iCal block or a plain RRULE string.
 */
export function validateRRule(expr: string): void {
  // rrule.js throws a plain Error with the parse reason.
  const rule = RRule.fromString(expr);
  if (!rule) throw new Error(`invalid rrule: ${expr}`);
}

/**
 * Validate an IANA timezone using the platform's Intl database.
 * Throws if the timezone is not recognized.
 */
export function validateTimezone(tz: string): void {
  try {
    // Constructing a DateTimeFormat with an unknown tz throws RangeError.
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
  } catch {
    throw new Error(`invalid timezone: ${tz}`);
  }
}

/**
 * Refuse to save a schedule whose every RRULE occurrence falls inside a
 * quiet-hours window — nextFireAt would exhaust its iteration cap and the
 * schedule would never fire. Thin throw-wrapper over the shared
 * `hasVisibleOccurrence` (one copy of the visible-occurrence walk lives in
 * the contract package, consumed by the UI, CLI, and api-server alike).
 */
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
      // Legacy cron schedules are UTC by contract.
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
  // Without BYSECOND, occurrences inherit dtstart's seconds — zero them.
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

// Wall-clock fields of `instant` in `tz`, carried in the Date's UTC fields.
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

// Inverse of toWallClock; the second offset read resolves DST boundaries.
function toInstant(wall: Date, tz: string): Date {
  const guess = wall.getTime() - tzOffsetMs(wall, tz);
  return new Date(wall.getTime() - tzOffsetMs(new Date(guess), tz));
}

function tzOffsetMs(instant: Date, tz: string): number {
  return toWallClock(instant, tz).getTime() - instant.getTime();
}
