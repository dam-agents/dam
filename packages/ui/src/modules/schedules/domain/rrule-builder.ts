import type { Weekday } from "rrule";
import { Frequency, RRule } from "rrule";

/**
 * Preset shapes the user can pick in the create-schedule form.
 * Each preset carries a `days` filter (ISO 1=Mon..7=Sun) that is applied as
 * `BYDAY` when it's a proper subset of the full week — RRULE allows BYDAY
 * with any FREQ, so this combines freely with minutely/hourly/daily.
 * `buildRRule` emits an RFC 5545 RRULE body (no `RRULE:` prefix).
 */
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

/** Returns an RRULE body without the `RRULE:` prefix, ready to store in spec.yaml. */
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

/**
 * Maps an ISO-weekday filter to an rrule.js `byweekday` option. Returns empty
 * object when the filter covers the whole week — no point emitting a redundant
 * `BYDAY=MO,TU,WE,TH,FR,SA,SU`.
 */
function daysFilterToByWeekday(days: number[]): { byweekday?: Weekday[] } {
  if (days.length === 0 || days.length === ALL_DAYS.length) return {};
  const mapped = days.map((d) => ISO_TO_RRULE_WEEKDAY[d]).filter(Boolean);
  return mapped.length > 0 ? { byweekday: mapped } : {};
}

function stripRRulePrefix(s: string): string {
  // rrule.js toString() yields "RRULE:FREQ=...". The spec body drops that prefix.
  return s.replace(/^RRULE:/, "");
}

/** Human-readable summary for an RRULE body. Falls back to the raw string. */
export function rruleToText(rruleBody: string): string {
  try {
    const rule = RRule.fromString(rruleBody);
    return rule.toText();
  } catch {
    return rruleBody;
  }
}

/**
 * Reverse of buildRRule: recognise RRULE bodies produced by this builder
 * and return the preset that generated them. Falls back to "custom" for
 * anything the preset surface doesn't cover — user still gets editable
 * fields via the custom textarea.
 */
export function detectPreset(rruleBody: string): FrequencyPreset {
  try {
    const options = RRule.parseString(rruleBody);
    const days = byweekdayToIso(options.byweekday) ?? [...ALL_DAYS];
    const interval =
      typeof options.interval === "number" ? options.interval : 1;

    // rrule.js's parseString returns BYHOUR/BYMINUTE as either a single
    // number or number[] depending on the input. Normalise to an array.
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
    // Both DAILY and WEEKLY-with-BYHOUR+BYMINUTE collapse to the "daily"
    // preset now that days-of-week is a universal filter.
    if (
      (options.freq === Frequency.DAILY || options.freq === Frequency.WEEKLY) &&
      hours.length === 1 &&
      minutes.length === 1
    ) {
      return { kind: "daily", hour: hours[0], minute: minutes[0], days };
    }
  } catch {
    // fall through
  }
  return { kind: "custom", rrule: rruleBody };
}

function toNumArray(v: unknown): number[] {
  if (v == null) return [];
  if (Array.isArray(v))
    return v.filter((x): x is number => typeof x === "number");
  return typeof v === "number" ? [v] : [];
}

/** Inverse of daysFilterToByWeekday — returns null when rrule has no byweekday. */
function byweekdayToIso(byweekday: unknown): number[] | null {
  if (!Array.isArray(byweekday) || byweekday.length === 0) return null;
  const mapped: number[] = [];
  for (const bw of byweekday) {
    // rrule.js encodes Weekday as a Weekday instance with `.weekday`, or as
    // a raw number 0..6 (0=Mon). Handle both.
    const n =
      typeof bw === "number" ? bw : (bw as { weekday?: number }).weekday;
    if (typeof n !== "number") continue;
    // 0=Mon..6=Sun in rrule.js → 1..7 ISO
    mapped.push(n + 1);
  }
  mapped.sort((a, b) => a - b);
  return mapped.length > 0 ? mapped : null;
}

/** Detect the browser's IANA timezone, with UTC fallback. */
export function detectTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

interface QuietWindow {
  startTime: string;
  endTime: string;
  enabled: boolean;
}

/**
 * Client-side mirror of the api-server's isInQuietHours (recurrences.ts).
 *
 * rrule.js returns occurrences as UTC Date objects whose UTC components
 * reflect the RRULE's BY* fields verbatim (BYHOUR=9 → 09:00Z) — wall
 * clock in the schedule's timezone, exactly the frame quiet-hours HH:MM
 * strings are in. Hence: compare UTC components, NOT local — otherwise
 * the browser's offset (e.g. Europe/Prague +2h) silently shifts fire
 * times into or out of quiet windows.
 */
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

/**
 * Check that at least one of the next N RRULE occurrences falls outside
 * every enabled quiet window. Uses `rule.all(cb)` (single linear pass,
 * early-exit via callback) because repeated `rule.after(cursor)` is
 * O(N²) — each call re-iterates from DTSTART internally. The cap is
 * intentionally small for UI responsiveness; the server enforces a
 * larger cap as the authoritative check.
 */
export function hasVisibleOccurrence(
  rruleBody: string,
  windows: QuietWindow[],
): boolean {
  const enabled = windows.filter((w) => w.enabled);
  if (enabled.length === 0) return true;
  try {
    const rule = RRule.fromString(rruleBody);
    let visible = false;
    // 1440 = one full day of minute-frequency occurrences. Covers any
    // reasonable frequency for a meaningful horizon (60 days of hourly,
    // ~4 years of daily) and matches the server's cap. rule.all is a
    // single linear pass with early-exit via the callback, so even the
    // pathological case finishes in tens of milliseconds.
    rule.all((date, i) => {
      if (i >= 1440) return false;
      if (!isInQuietHours(date, enabled)) {
        visible = true;
        return false; // one visible fire is enough
      }
      return true;
    });
    return visible;
  } catch {
    // Parse errors are surfaced by the RRULE validation path; we just
    // defer to it rather than double-reporting.
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
