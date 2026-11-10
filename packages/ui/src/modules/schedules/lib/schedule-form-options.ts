import type { FrequencyPreset } from "api-server-api";

type RunKind = FrequencyPreset["kind"];

export const RUN_OPTIONS: { value: RunKind; label: string }[] = [
  { value: "daily", label: "Daily" },
  { value: "hourly", label: "Hourly" },
  { value: "minutely", label: "Every N minutes" },
  { value: "custom", label: "Custom rule" },
];

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

export function formatTime12(value: string): string {
  const [hour = 0, minute = 0] = value.split(":").map(Number);
  const period = hour < 12 ? "AM" : "PM";
  const h = hour % 12 === 0 ? 12 : hour % 12;
  return `${h}:${pad(minute)} ${period}`;
}

export const TIME_OPTIONS: { value: string; label: string }[] = Array.from(
  { length: 48 },
  (_, i) => {
    const hour = Math.floor(i / 2);
    const minute = i % 2 === 0 ? 0 : 30;
    const value = `${pad(hour)}:${pad(minute)}`;
    return { value, label: formatTime12(value) };
  },
);

type IntlWithSupported = typeof Intl & {
  supportedValuesOf?: (key: "timeZone") => string[];
};

function offsetLabel(zone: string): string {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      timeZoneName: "shortOffset",
    }).formatToParts(new Date());
    return parts.find((p) => p.type === "timeZoneName")?.value ?? "";
  } catch {
    return "";
  }
}

const SUPPORTED_ZONES =
  (Intl as IntlWithSupported).supportedValuesOf?.("timeZone") ?? [];

export const TIMEZONE_OPTIONS: { value: string; label: string }[] = [
  ...(SUPPORTED_ZONES.includes("UTC") ? [] : [{ value: "UTC", label: "UTC" }]),
  ...SUPPORTED_ZONES.map((zone) => {
    const offset = offsetLabel(zone);
    return { value: zone, label: offset ? `${zone} (${offset})` : zone };
  }),
];

export const DAYS_ISO: { iso: number; label: string; name: string }[] = [
  { iso: 1, label: "Mon", name: "Monday" },
  { iso: 2, label: "Tue", name: "Tuesday" },
  { iso: 3, label: "Wed", name: "Wednesday" },
  { iso: 4, label: "Thu", name: "Thursday" },
  { iso: 5, label: "Fri", name: "Friday" },
  { iso: 6, label: "Sat", name: "Saturday" },
  { iso: 7, label: "Sun", name: "Sunday" },
];

const WEEKDAYS = [1, 2, 3, 4, 5];
const WEEKEND = [6, 7];

/** UNIT_BOUNDARY_DESCRIPTION: none picked is not a value but an error the form names, so it has no summary; else the picked days in the words the Days dropdown shows: a named set when they make one, else the short names in week order. */
export function daysSummary(days: readonly number[]): string | null {
  const picked = DAYS_ISO.filter((d) => days.includes(d.iso));
  const only = (set: number[]) =>
    picked.length === set.length && set.every((d) => days.includes(d));
  if (picked.length === 0) return null;
  if (picked.length === DAYS_ISO.length) return "Every day";
  if (only(WEEKDAYS)) return "Weekdays";
  if (only(WEEKEND)) return "Weekends";
  return picked.map((d) => d.label).join(", ");
}
