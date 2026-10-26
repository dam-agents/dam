import {
  ALL_DAYS,
  buildRRule,
  detectPreset,
  type FrequencyPreset,
} from "api-server-api";
import { match } from "ts-pattern";

const DAY_NAMES = [
  "",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
];
const WEEKDAYS = [1, 2, 3, 4, 5];
const WEEKEND = [6, 7];

export interface CreatedSchedule {
  rrule: string;
  timezone: string;
  task: string;
  advanced: boolean;
}

function timeOf(hour: number, minute: number): string {
  const h = hour % 12 === 0 ? 12 : hour % 12;
  const suffix = hour < 12 ? "am" : "pm";
  return minute === 0
    ? `${String(h)}${suffix}`
    : `${String(h)}:${String(minute).padStart(2, "0")}${suffix}`;
}

function sameDays(
  days: readonly number[],
  expected: readonly number[],
): boolean {
  return (
    days.length === expected.length &&
    [...days].sort((a, b) => a - b).every((d, i) => d === expected[i])
  );
}

function daysOf(days: readonly number[]): string {
  if (sameDays(days, ALL_DAYS)) return "daily";
  if (sameDays(days, WEEKDAYS)) return "every weekday";
  if (sameDays(days, WEEKEND)) return "on weekends";
  if (days.length === 1) return `every ${DAY_NAMES[days[0] ?? 1]}`;
  return `on ${days
    .map((d) => DAY_NAMES[d] ?? "")
    .filter(Boolean)
    .join(", ")}`;
}

function every(interval: number, unit: string): string {
  return interval === 1
    ? `every ${unit}`
    : `every ${String(interval)} ${unit}s`;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: the cadence in the user's own terms, with the zone
 * the form saved for a time of day, because a bare "3pm" means another schedule
 * to an Agent that thinks in UTC. A cadence the presets do not name gets none.
 */
function cadenceOf(preset: FrequencyPreset, timezone: string): string | null {
  return match(preset)
    .with({ kind: "daily" }, (p) =>
      timezone === ""
        ? null
        : `${timeOf(p.hour, p.minute)} ${timezone} ${daysOf(p.days)}`,
    )
    .with({ kind: "hourly" }, (p) =>
      sameDays(p.days, ALL_DAYS) ? every(p.interval, "hour") : null,
    )
    .with({ kind: "minutely" }, (p) =>
      sameDays(p.days, ALL_DAYS) ? every(p.interval, "minute") : null,
    )
    .with({ kind: "custom" }, () => null)
    .exhaustive(() => null);
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: the shortest sentence that gives a schedule back
 * when it is typed into the chat instead of filled into the form: its cadence,
 * its zone and its whole task. It emits nothing when any part of the schedule
 * is one the sentence cannot carry — an advanced field the form set, or an
 * rrule the presets only partly describe — because a prompt that builds another
 * schedule is worse than no prompt.
 */
export function justAskPrompt({
  rrule,
  timezone,
  task,
  advanced,
}: CreatedSchedule): string | null {
  const preset = detectPreset(rrule);
  if (buildRRule(preset) !== rrule) return null;
  const when = cadenceOf(preset, timezone);
  const what = task.replace(/\s+/g, " ").trim();
  if (advanced || when === null || what === "") return null;
  return `${when} ${what}`;
}
