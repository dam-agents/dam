import * as rruleModule from "rrule";
import type { Weekday } from "rrule";
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

export function isInQuietHours(date: Date, windows: QuietWindow[]): boolean {
  if (windows.length === 0) return false;
  const m = date.getUTCHours() * 60 + date.getUTCMinutes();
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

type RRuleOptions = ReturnType<typeof RRule.parseString>;

export function anchorsAtMidnight(options: RRuleOptions): boolean {
  return (
    (options.freq === Frequency.HOURLY ||
      options.freq === Frequency.MINUTELY) &&
    (toNumArray(options.byhour).length > 0 ||
      toNumArray(options.byminute).length > 0)
  );
}

export function canOccur(options: RRuleOptions): boolean {
  if (!anchorsAtMidnight(options)) return true;
  const interval =
    typeof options.interval === "number" && options.interval > 0
      ? options.interval
      : 1;
  const hourly = options.freq === Frequency.HOURLY;
  const phase = gcd(hourly ? interval * 60 : interval, 24 * 60);
  const hours = orAll(toNumArray(options.byhour), 24);
  const minutes = hourly ? [0] : orAll(toNumArray(options.byminute), 60);
  return hours.some((h) => minutes.some((m) => (h * 60 + m) % phase === 0));
}

function orAll(values: number[], count: number): number[] {
  return values.length > 0
    ? values
    : Array.from({ length: count }, (_, i) => i);
}

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

export function hasVisibleOccurrence(
  rruleBody: string,
  windows: QuietWindow[],
): boolean {
  const enabled = windows.filter((w) => w.enabled);
  if (enabled.length === 0) return true;
  try {
    const options = RRule.parseString(rruleBody);
    if (!canOccur(options)) return true;
    const dtstart = new Date();
    dtstart.setUTCSeconds(0, 0);
    if (anchorsAtMidnight(options)) dtstart.setUTCHours(0, 0);
    const rule = new RRule({ dtstart, ...options });
    let visible = false;
    rule.all((date, i) => {
      if (i >= 1440) return false;
      if (!isInQuietHours(date, enabled)) {
        visible = true;
        return false;
      }
      return true;
    });
    return visible;
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
