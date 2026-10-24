import { ALL_DAYS, detectPreset, type FrequencyPreset } from "api-server-api";

const DAY_NAMES = ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const WEEKDAYS = [1, 2, 3, 4, 5];
const WEEKEND = [6, 7];
const TASK_MAX = 100;

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
  if (sameDays(days, WEEKEND)) return "every weekend day";
  if (days.length === 1) return `every ${DAY_NAMES[days[0] ?? 1]}`;
  return `on ${days
    .map((d) => DAY_NAMES[d] ?? "")
    .filter(Boolean)
    .join(", ")}`;
}

function lowerStart(text: string): string {
  const [first = ""] = text.split(" ");
  return first.length > 1 && first.slice(1) === first.slice(1).toLowerCase()
    ? text.charAt(0).toLowerCase() + text.slice(1)
    : text;
}

function shortTask(task: string): string {
  const first =
    task
      .trim()
      .split(/\n/)[0]
      ?.split(/(?<=[.!?])\s/)[0] ?? "";
  const text = first
    .replace(/\s+/g, " ")
    .replace(/[.!?]+$/, "")
    .trim();
  if (text.length <= TASK_MAX) return text;
  const cut = text.slice(0, TASK_MAX);
  return `${cut.slice(0, cut.lastIndexOf(" ")) || cut}…`;
}

function every(interval: number, unit: string): string {
  return interval === 1
    ? `every ${unit}`
    : `every ${String(interval)} ${unit}s`;
}

function cadenceOf(preset: FrequencyPreset): string | null {
  switch (preset.kind) {
    case "daily":
      return `${timeOf(preset.hour, preset.minute)} ${daysOf(preset.days)}`;
    case "hourly":
      return sameDays(preset.days, ALL_DAYS)
        ? every(preset.interval, "hour")
        : null;
    case "minutely":
      return sameDays(preset.days, ALL_DAYS)
        ? every(preset.interval, "minute")
        : null;
    case "custom":
      return null;
  }
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: the shortest sentence that gives a schedule back
 * when it is typed into the chat instead of filled into the form: its cadence
 * in the user's own terms and the task it runs. Cadences no preset describes
 * have no reliable prompt, so they get none rather than a wrong one.
 */
export function justAskPrompt(rrule: string, task: string): string | null {
  const when = cadenceOf(detectPreset(rrule));
  const what = lowerStart(shortTask(task));
  if (when === null || what === "") return null;
  return `${when} ${what}`;
}
