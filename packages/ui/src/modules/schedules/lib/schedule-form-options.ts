import type { FrequencyPreset } from "api-server-api";

export type RunKind = FrequencyPreset["kind"];

export const RUN_OPTIONS: { value: RunKind; label: string }[] = [
  { value: "daily", label: "Daily" },
  { value: "hourly", label: "Hourly" },
  { value: "minutely", label: "Every N minutes" },
  { value: "custom", label: "Custom (RRULE)" },
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

export const TIMEZONE_OPTIONS: { value: string; label: string }[] = (
  (Intl as IntlWithSupported).supportedValuesOf?.("timeZone") ?? []
).map((zone) => {
  const offset = offsetLabel(zone);
  return { value: zone, label: offset ? `${zone} (${offset})` : zone };
});
