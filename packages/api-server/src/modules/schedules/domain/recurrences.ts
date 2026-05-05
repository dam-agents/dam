import { CronExpressionParser } from "cron-parser";
import rrulePkg from "rrule";

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

interface QuietWindow {
  startTime: string;
  endTime: string;
  enabled: boolean;
}

/**
 * Refuse to save a schedule whose every RRULE occurrence falls inside a
 * quiet-hours window — the controller's goroutine would spin its iteration
 * cap once and then never fire. Iteration cap matches the Go side (1440,
 * i.e. one day of minute-granularity occurrences). Uses rule.all with
 * early-exit instead of a rule.after loop, which is O(N²) in rrule.js.
 */
export function validateHasVisibleOccurrence(rruleExpr: string, windows: QuietWindow[]): void {
  const enabled = windows.filter((w) => w.enabled);
  if (enabled.length === 0) return;
  const rule = RRule.fromString(rruleExpr);
  let visible = false;
  rule.all((date, i) => {
    if (i >= 1440) return false;
    if (!isInQuietHours(date, enabled)) {
      visible = true;
      return false;
    }
    return true;
  });
  if (!visible) {
    throw new Error("quiet hours cover every scheduled occurrence — this schedule would never fire");
  }
}

// Compare against UTC components rather than local: rrule.js produces
// Dates whose UTC h:m echoes the RRULE's BYHOUR/BYMINUTE verbatim, which
// is what the Go controller treats as wall-clock-in-schedule-tz. Reading
// local components would apply the server's own tz offset incorrectly.
function isInQuietHours(date: Date, windows: QuietWindow[]): boolean {
  const m = date.getUTCHours() * 60 + date.getUTCMinutes();
  for (const w of windows) {
    const start = parseHHMM(w.startTime);
    const end = parseHHMM(w.endTime);
    if (start == null || end == null || start === end) continue;
    const hit = start < end ? m >= start && m < end : m >= start || m < end;
    if (hit) return true;
  }
  return false;
}

function parseHHMM(s: string): number | null {
  const match = /^(\d{2}):(\d{2})$/.exec(s);
  if (!match) return null;
  const h = Number(match[1]);
  const mi = Number(match[2]);
  if (h < 0 || h > 23 || mi < 0 || mi > 59) return null;
  return h * 60 + mi;
}
