/// <reference lib="esnext.temporal" />
import { RRuleTemporal } from "rrule-temporal";
import { toText } from "rrule-temporal/totext";
import type { QuietWindow } from "./types.js";

export type FrequencyPreset =
  | { kind: "minutely"; interval: number; days: number[] }
  | { kind: "hourly"; interval: number; days: number[] }
  | { kind: "daily"; hour: number; minute: number; days: number[] }
  | { kind: "custom"; rrule: string };

export const ALL_DAYS: number[] = [1, 2, 3, 4, 5, 6, 7];

const ISO_TO_BYDAY = ["", "MO", "TU", "WE", "TH", "FR", "SA", "SU"];

export function buildRRule(preset: FrequencyPreset): string {
  if (preset.kind === "custom") {
    return stripRRulePrefix(preset.rrule.trim());
  }
  const parts =
    preset.kind === "daily"
      ? [
          "FREQ=DAILY",
          `BYHOUR=${preset.hour}`,
          `BYMINUTE=${preset.minute}`,
          "BYSECOND=0",
        ]
      : [`FREQ=${preset.kind.toUpperCase()}`, `INTERVAL=${preset.interval}`];
  const byDay = daysFilterToByDay(preset.days);
  return [...parts, ...(byDay ? [`BYDAY=${byDay}`] : [])].join(";");
}

function daysFilterToByDay(days: number[]): string | null {
  if (days.length === 0 || days.length === ALL_DAYS.length) return null;
  const mapped = days.map((d) => ISO_TO_BYDAY[d]).filter(Boolean);
  return mapped.length > 0 ? mapped.join(",") : null;
}

function stripRRulePrefix(s: string): string {
  return s.replace(/^RRULE:/, "");
}

function parseRRule(rruleBody: string): RRuleTemporal {
  return new RRuleTemporal({
    rruleString: withUtcUntil(rruleBody, "UTC"),
    dtstart: anchoredAt("UTC"),
  });
}

export function rruleToText(rruleBody: string): string {
  try {
    return toText(parseRRule(rruleBody), undefined, {
      excludeTzAbbreviation: true,
    });
  } catch {
    return rruleBody;
  }
}

export function detectPreset(rruleBody: string): FrequencyPreset {
  try {
    const options = parseRRule(rruleBody).options();
    const days = byDayToIso(options.byDay) ?? [...ALL_DAYS];
    const interval = options.interval ?? 1;
    const hours = options.byHour ?? [];
    const minutes = options.byMinute ?? [];

    if (
      options.freq === "MINUTELY" &&
      hours.length === 0 &&
      minutes.length === 0
    ) {
      return { kind: "minutely", interval, days };
    }
    if (
      options.freq === "HOURLY" &&
      hours.length === 0 &&
      minutes.length === 0
    ) {
      return { kind: "hourly", interval, days };
    }
    if (
      (options.freq === "DAILY" || options.freq === "WEEKLY") &&
      hours.length === 1 &&
      minutes.length === 1
    ) {
      return { kind: "daily", hour: hours[0], minute: minutes[0], days };
    }
  } catch {}
  return { kind: "custom", rrule: rruleBody };
}

function byDayToIso(byDay: string[] | undefined): number[] | null {
  const mapped = (byDay ?? [])
    .map((d) => ISO_TO_BYDAY.indexOf(d.slice(-2)))
    .filter((n) => n > 0)
    .sort((a, b) => a - b);
  return mapped.length > 0 ? mapped : null;
}

export function detectTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

const RRULE_ANCHOR = { year: 2001, month: 1, day: 1 };

function anchoredAt(timeZone: string): Temporal.ZonedDateTime {
  return Temporal.ZonedDateTime.from({ ...RRULE_ANCHOR, timeZone });
}
const MAX_PERIODS = 1500;
const MAX_CANDIDATES = 10_000;
const QUIET_SKIP_LIMIT = 64;
const MAX_RRULE_LENGTH = 1000;
const MAX_INTERVAL = 10_000;
const FLOATING_UNTIL = /UNTIL=(\d{8}T\d{6})(?!Z)/;

export type VisibleOccurrence =
  | { kind: "next"; at: Temporal.ZonedDateTime }
  | { kind: "exhausted" }
  | { kind: "suppressed" };

function withUtcUntil(rruleBody: string, timezone: string): string {
  return rruleBody.replace(FLOATING_UNTIL, (_, local: string) => {
    const utc = Temporal.PlainDateTime.from(local)
      .toZonedDateTime(timezone)
      .toInstant()
      .toZonedDateTimeISO("UTC");
    const pad = (n: number, width = 2) => String(n).padStart(width, "0");
    return `UNTIL=${pad(utc.year, 4)}${pad(utc.month)}${pad(utc.day)}T${pad(utc.hour)}${pad(utc.minute)}${pad(utc.second)}Z`;
  });
}

export function nextVisibleOccurrence(
  rruleBody: string,
  timezone: string,
  after: Temporal.Instant,
  windows: QuietWindow[],
): VisibleOccurrence {
  const enabled = windows.filter((w) => w.enabled);
  const rule = new RRuleTemporal({
    rruleString: withUtcUntil(rruleBody, timezone),
    dtstart: anchoredAt(timezone),
    maxIterations: MAX_PERIODS,
    maxCandidateEvaluations: MAX_CANDIDATES,
  });
  let cursor = after.toZonedDateTimeISO(timezone);
  let inclusive = false;
  for (let i = 0; i < QUIET_SKIP_LIMIT; i++) {
    const next = rule.next(cursor, inclusive);
    if (!next) return i === 0 ? { kind: "exhausted" } : { kind: "suppressed" };
    const end = quietWindowEnd(next, enabled);
    if (!end) return { kind: "next", at: next };
    inclusive = Temporal.ZonedDateTime.compare(end, next) > 0;
    cursor = inclusive ? end : next;
  }
  return { kind: "suppressed" };
}

function quietWindowEnd(
  time: Temporal.ZonedDateTime,
  windows: QuietWindow[],
): Temporal.ZonedDateTime | null {
  const m = time.hour * 60 + time.minute;
  let latest: Temporal.ZonedDateTime | null = null;
  for (const w of windows) {
    const start = parseHHMM(w.startTime);
    const end = parseHHMM(w.endTime);
    if (start == null || end == null || start === end) continue;
    const hit = start < end ? m >= start && m < end : m >= start || m < end;
    if (!hit) continue;
    const day = start > end && m >= start ? time.add({ days: 1 }) : time;
    const at = firstWallTimeAfter(
      day.toPlainDate().toPlainDateTime(
        Temporal.PlainTime.from({
          hour: Math.floor(end / 60),
          minute: end % 60,
        }),
      ),
      time,
    );
    if (!latest || Temporal.ZonedDateTime.compare(at, latest) > 0) latest = at;
  }
  return latest;
}

function firstWallTimeAfter(
  wall: Temporal.PlainDateTime,
  after: Temporal.ZonedDateTime,
): Temporal.ZonedDateTime {
  const earlier = wall.toZonedDateTime(after.timeZoneId, {
    disambiguation: "earlier",
  });
  const first = earlier.toPlainDateTime().equals(wall)
    ? earlier
    : (earlier.getTimeZoneTransition("next") ?? earlier);
  if (Temporal.ZonedDateTime.compare(first, after) > 0) return first;
  return wall.toZonedDateTime(after.timeZoneId, { disambiguation: "later" });
}

export function rruleProblem(rruleBody: string): string | null {
  if (rruleBody.length > MAX_RRULE_LENGTH)
    return `an rrule longer than ${MAX_RRULE_LENGTH} characters is not supported`;
  const options = parseRRule(rruleBody).options();
  if (options.freq === "SECONDLY")
    return "FREQ=SECONDLY is not supported, schedules run at minute granularity";
  if (options.count != null)
    return "COUNT is not supported, a schedule has no start date to count from";
  if ((options.interval ?? 1) > MAX_INTERVAL)
    return `INTERVAL above ${MAX_INTERVAL} is not supported`;
  return null;
}

export function hasVisibleOccurrence(
  rruleBody: string,
  timezone: string,
  windows: QuietWindow[],
): boolean {
  const enabled = windows.filter((w) => w.enabled);
  if (enabled.length === 0) return true;
  try {
    const next = nextVisibleOccurrence(
      rruleBody,
      timezone,
      Temporal.Now.instant(),
      enabled,
    );
    return next.kind !== "suppressed";
  } catch {
    return true;
  }
}

function parseHHMM(s: string): number | null {
  const match = /^(\d{2}):(\d{2})$/.exec(s);
  if (!match) return null;
  const h = Number(match[1]);
  const mi = Number(match[2]);
  if (h < 0 || h > 23 || mi < 0 || mi > 59) return null;
  return h * 60 + mi;
}
