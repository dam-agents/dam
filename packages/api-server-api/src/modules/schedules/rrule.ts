import * as rruleModule from "rrule";
import type { Weekday } from "rrule";
import type { QuietWindow } from "./types.js";

const rrulePkg = (Reflect.get(rruleModule, "default") ??
  rruleModule) as typeof rruleModule;
const { Frequency, RRule, RRuleSet } = rrulePkg;

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

const DAY_MINUTES = 24 * 60;
const DAY_MS = DAY_MINUTES * 60_000;

export function occurrenceRule(
  options: RRuleOptions,
  dtstart: Date,
): InstanceType<typeof RRule> | null {
  if (rruleProblem(options)) return null;
  if (!pinsTimeOfDay(options)) return new RRule({ dtstart, ...options });
  const cycle = cycleDays(stepMinutes(options));
  const today = Math.floor(dtstart.getTime() / DAY_MS);
  const set = new RRuleSet();
  for (const slot of pinnedSlots(options)) {
    const day = today + mod(slot.cycleDay - today, cycle);
    set.rrule(
      new RRule({
        ...options,
        dtstart: new Date(day * DAY_MS),
        freq: Frequency.DAILY,
        interval: cycle,
        byhour: slot.hours,
        byminute: slot.minutes,
      }),
    );
  }
  return set;
}

export function rruleProblem(options: RRuleOptions): string | null {
  if (!dayFiltersMatchSomeDate(options))
    return "its BYMONTH/BYMONTHDAY/BYYEARDAY/BYWEEKNO filters match no date";
  if (!pinsTimeOfDay(options)) return null;
  if (toNumArray(options.bysetpos).length > 0)
    return "BYSETPOS is not supported on an HOURLY or MINUTELY rule that sets BYHOUR or BYMINUTE";
  if (pinnedSlots(options).length === 0)
    return "its INTERVAL never lands on its BYHOUR/BYMINUTE";
  return null;
}

function pinsTimeOfDay(options: RRuleOptions): boolean {
  return (
    (options.freq === Frequency.HOURLY ||
      options.freq === Frequency.MINUTELY) &&
    (toNumArray(options.byhour).length > 0 ||
      toNumArray(options.byminute).length > 0)
  );
}

function stepMinutes(options: RRuleOptions): number {
  const interval =
    typeof options.interval === "number" && options.interval > 0
      ? options.interval
      : 1;
  return options.freq === Frequency.HOURLY ? interval * 60 : interval;
}

type PinnedSlot = { cycleDay: number; hours: number[]; minutes: number[] };

function pinnedSlots(options: RRuleOptions): PinnedSlot[] {
  const step = stepMinutes(options);
  const hourly = options.freq === Frequency.HOURLY;
  const byminute = toNumArray(options.byminute);
  const minutes = hourly && byminute.length === 0 ? [0] : orAll(byminute, 60);
  const slots = new Map<string, PinnedSlot>();
  for (const h of orAll(toNumArray(options.byhour), 24)) {
    const minutesByDay = new Map<number, number[]>();
    for (const m of minutes) {
      const cycleDay = stepLandingDay(h * 60 + (hourly ? 0 : m), step);
      if (cycleDay === null) continue;
      minutesByDay.set(cycleDay, [...(minutesByDay.get(cycleDay) ?? []), m]);
    }
    for (const [cycleDay, dayMinutes] of minutesByDay) {
      const key = `${cycleDay}:${dayMinutes.join(",")}`;
      const slot = slots.get(key) ?? {
        cycleDay,
        hours: [],
        minutes: dayMinutes,
      };
      slot.hours.push(h);
      slots.set(key, slot);
    }
  }
  return [...slots.values()];
}

function cycleDays(step: number): number {
  return step / gcd(step, DAY_MINUTES);
}

function stepLandingDay(minuteOfDay: number, step: number): number | null {
  const g = gcd(step, DAY_MINUTES);
  if (minuteOfDay % g !== 0) return null;
  const cycle = step / g;
  return mod(-(minuteOfDay / g) * modInverse(DAY_MINUTES / g, cycle), cycle);
}

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

function mod(a: number, n: number): number {
  return ((a % n) + n) % n;
}

function modInverse(a: number, n: number): number {
  let [r0, r1, t0, t1] = [n, mod(a, n), 0, 1];
  while (r1 !== 0) {
    const q = Math.floor(r0 / r1);
    [r0, r1, t0, t1] = [r1, r0 - q * r1, t1, t0 - q * t1];
  }
  return mod(t0, n);
}

const PROBE_START = new Date(Date.UTC(2000, 0, 1));

function dayFiltersMatchSomeDate(options: RRuleOptions): boolean {
  const { bymonth, bymonthday, byyearday, byweekno, byeaster } = options;
  const filtered =
    toNumArray(bymonth).length > 0 ||
    toNumArray(bymonthday).length > 0 ||
    toNumArray(byyearday).length > 0 ||
    toNumArray(byweekno).length > 0 ||
    typeof byeaster === "number";
  if (!filtered) return true;
  const probe = new RRule({
    freq: Frequency.YEARLY,
    dtstart: PROBE_START,
    ...(options.wkst != null && { wkst: options.wkst }),
    bymonth,
    bymonthday,
    byyearday,
    byweekno,
    byeaster: byeaster ?? null,
    byweekday: plainWeekdays(options.byweekday),
    byhour: 0,
    byminute: 0,
    bysecond: 0,
  });
  return probe.after(PROBE_START, true) !== null;
}

function plainWeekdays(value: RRuleOptions["byweekday"]): number[] | null {
  if (value === null || value === undefined) return null;
  const days = Array.isArray(value) ? value : [value];
  return days.map((d) => {
    if (typeof d === "number") return d;
    return typeof d === "string"
      ? rrulePkg.Weekday.fromStr(d).weekday
      : d.weekday;
  });
}

function orAll(values: number[], count: number): number[] {
  return values.length > 0
    ? values
    : Array.from({ length: count }, (_, i) => i);
}

export function hasVisibleOccurrence(
  rruleBody: string,
  windows: QuietWindow[],
): boolean {
  const enabled = windows.filter((w) => w.enabled);
  if (enabled.length === 0) return true;
  try {
    const dtstart = new Date();
    dtstart.setUTCSeconds(0, 0);
    const rule = occurrenceRule(RRule.parseString(rruleBody), dtstart);
    if (!rule) return true;
    let visible = false;
    rule.all((date, i) => {
      if (visible || i >= 1440) return false;
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
