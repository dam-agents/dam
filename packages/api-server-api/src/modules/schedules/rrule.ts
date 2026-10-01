/// <reference lib="esnext.temporal" />
import * as rruleModule from "rrule";
import type { Weekday } from "rrule";
import { RRuleTemporal } from "rrule-temporal";
import type { QuietWindow } from "./types.js";

const rrulePkg = (Reflect.get(rruleModule, "default") ??
  rruleModule) as typeof rruleModule;
const { Frequency, RRule } = rrulePkg;

export type FrequencyPreset =
  | { kind: "minutely"; interval: number; days: number[] }
  | { kind: "hourly"; interval: number; days: number[] }
  | { kind: "daily"; hour: number; minute: number; days: number[] }
  | { kind: "custom"; rrule: string };

export const ALL_DAYS: number[] = [1, 2, 3, 4, 5, 6, 7];

const ISO_TO_RRULE_WEEKDAY: Record<number, Weekday> = {
  1: RRule.MO,
  2: RRule.TU,
  3: RRule.WE,
  4: RRule.TH,
  5: RRule.FR,
  6: RRule.SA,
  7: RRule.SU,
};

export function buildRRule(preset: FrequencyPreset): string {
  if (preset.kind === "custom") {
    return stripRRulePrefix(preset.rrule.trim());
  }
  const opts = toOptions(preset);
  return stripRRulePrefix(new RRule(opts).toString());
}

function toOptions(preset: Exclude<FrequencyPreset, { kind: "custom" }>) {
  const byweekday = daysFilterToByWeekday(preset.days);
  switch (preset.kind) {
    case "minutely":
      return {
        freq: Frequency.MINUTELY,
        interval: preset.interval,
        ...byweekday,
      };
    case "hourly":
      return {
        freq: Frequency.HOURLY,
        interval: preset.interval,
        ...byweekday,
      };
    case "daily":
      return {
        freq: Frequency.DAILY,
        byhour: [preset.hour],
        byminute: [preset.minute],
        bysecond: [0],
        ...byweekday,
      };
  }
}

function daysFilterToByWeekday(days: number[]): { byweekday?: Weekday[] } {
  if (days.length === 0 || days.length === ALL_DAYS.length) return {};
  const mapped = days.map((d) => ISO_TO_RRULE_WEEKDAY[d]).filter(Boolean);
  return mapped.length > 0 ? { byweekday: mapped } : {};
}

function stripRRulePrefix(s: string): string {
  return s.replace(/^RRULE:/, "");
}

export function rruleToText(rruleBody: string): string {
  try {
    const rule = RRule.fromString(rruleBody);
    return rule.toText();
  } catch {
    return rruleBody;
  }
}

export function detectPreset(rruleBody: string): FrequencyPreset {
  try {
    const options = RRule.parseString(rruleBody);
    const days = byweekdayToIso(options.byweekday) ?? [...ALL_DAYS];
    const interval =
      typeof options.interval === "number" ? options.interval : 1;

    const hours = toNumArray(options.byhour);
    const minutes = toNumArray(options.byminute);

    if (
      options.freq === Frequency.MINUTELY &&
      hours.length === 0 &&
      minutes.length === 0
    ) {
      return { kind: "minutely", interval, days };
    }
    if (
      options.freq === Frequency.HOURLY &&
      hours.length === 0 &&
      minutes.length === 0
    ) {
      return { kind: "hourly", interval, days };
    }
    if (
      (options.freq === Frequency.DAILY || options.freq === Frequency.WEEKLY) &&
      hours.length === 1 &&
      minutes.length === 1
    ) {
      return { kind: "daily", hour: hours[0], minute: minutes[0], days };
    }
  } catch {}
  return { kind: "custom", rrule: rruleBody };
}

function toNumArray(v: unknown): number[] {
  if (v == null) return [];
  if (Array.isArray(v))
    return v.filter((x): x is number => typeof x === "number");
  return typeof v === "number" ? [v] : [];
}

function byweekdayToIso(byweekday: unknown): number[] | null {
  if (!Array.isArray(byweekday) || byweekday.length === 0) return null;
  const mapped: number[] = [];
  for (const bw of byweekday) {
    const n =
      typeof bw === "number" ? bw : (bw as { weekday?: number }).weekday;
    if (typeof n !== "number") continue;
    mapped.push(n + 1);
  }
  mapped.sort((a, b) => a - b);
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
const QUIET_SKIP_LIMIT = 1440;
const FLOATING_UNTIL = /UNTIL=(\d{8}T\d{6})(?!Z)/;

export type VisibleOccurrence =
  | { kind: "next"; at: Temporal.ZonedDateTime }
  | { kind: "exhausted" }
  | { kind: "suppressed" };

function nextOccurrence(
  rruleBody: string,
  timezone: string,
  after: Temporal.Instant,
): Temporal.ZonedDateTime | null {
  const rule = new RRuleTemporal({
    rruleString: withUtcUntil(rruleBody, timezone),
    dtstart: Temporal.ZonedDateTime.from({
      ...RRULE_ANCHOR,
      timeZone: timezone,
    }),
  });
  return rule.next(after.toZonedDateTimeISO(timezone), false);
}

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
  let cursor = after;
  for (let i = 0; i < QUIET_SKIP_LIMIT; i++) {
    const next = nextOccurrence(rruleBody, timezone, cursor);
    if (!next) return i === 0 ? { kind: "exhausted" } : { kind: "suppressed" };
    if (!isInQuietHours(next, enabled)) return { kind: "next", at: next };
    cursor = next.toInstant();
  }
  return { kind: "suppressed" };
}

export function rruleProblem(rruleBody: string): string | null {
  const options = RRule.parseString(rruleBody);
  if (options.freq === Frequency.SECONDLY)
    return "FREQ=SECONDLY is not supported, schedules run at minute granularity";
  if (options.count != null)
    return "COUNT is not supported, a schedule has no start date to count from";
  return null;
}

export function isInQuietHours(
  time: { hour: number; minute: number },
  windows: QuietWindow[],
): boolean {
  if (windows.length === 0) return false;
  const m = time.hour * 60 + time.minute;
  for (const w of windows) {
    if (!w.enabled) continue;
    const start = parseHHMM(w.startTime);
    const end = parseHHMM(w.endTime);
    if (start == null || end == null || start === end) continue;
    const hit = start < end ? m >= start && m < end : m >= start || m < end;
    if (hit) return true;
  }
  return false;
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
