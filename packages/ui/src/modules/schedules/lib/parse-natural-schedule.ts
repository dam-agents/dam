import { ALL_DAYS, detectTimezone } from "api-server-api";

import {
  scheduleFormDefaults,
  type ScheduleFormValues,
} from "../forms/schedule-form-schema.js";

export interface ParseResult {
  values: ScheduleFormValues;
  missing: ("timing" | "task")[];
}

const DAY_MAP: Record<string, number> = {
  monday: 1,
  mon: 1,
  mo: 1,
  tuesday: 2,
  tue: 2,
  tu: 2,
  wednesday: 3,
  wed: 3,
  we: 3,
  thursday: 4,
  thu: 4,
  th: 4,
  friday: 5,
  fri: 5,
  fr: 5,
  saturday: 6,
  sat: 6,
  sa: 6,
  sunday: 7,
  sun: 7,
  su: 7,
};

const WEEKDAY_NAMES = Object.keys(DAY_MAP);

function parseTime(input: string): { hour: number; minute: number } | null {
  const match = input.match(/(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i);
  if (!match) return null;
  let hour = parseInt(match[1], 10);
  const minute = match[2] ? parseInt(match[2], 10) : 0;
  const meridiem = match[3]?.toLowerCase();
  if (meridiem === "pm" && hour < 12) hour += 12;
  if (meridiem === "am" && hour === 12) hour = 0;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return { hour, minute };
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function parseDays(input: string): number[] | null {
  const lower = input.toLowerCase();
  if (/\bweekday/.test(lower)) return [1, 2, 3, 4, 5];
  if (/\bweekend/.test(lower)) return [6, 7];
  if (/\bevery\s*day\b/.test(lower) || /\bdaily\b/.test(lower))
    return [...ALL_DAYS];

  const found: number[] = [];
  for (const name of WEEKDAY_NAMES) {
    if (lower.includes(name)) {
      const iso = DAY_MAP[name];
      if (!found.includes(iso)) found.push(iso);
    }
  }
  return found.length > 0 ? found.sort() : null;
}

function extractTask(input: string): string {
  const patterns = [
    /(?:,\s*|\s+)(?:to|that|run(?:s)?|execute(?:s)?|do)\s+(.+)/i,
    /:\s*(.+)/,
    /[""“](.+?)[""”]/,
  ];
  for (const pattern of patterns) {
    const match = input.match(pattern);
    if (match?.[1]) {
      return match[1].trim().replace(/[.!]+$/, "");
    }
  }
  return "";
}

function parseInterval(
  input: string,
): { kind: "minutely" | "hourly"; interval: number } | null {
  const match = input.match(/every\s+(\d+)\s*(minute|hour)/i);
  if (match) {
    return {
      kind: match[2].toLowerCase().startsWith("minute") ? "minutely" : "hourly",
      interval: parseInt(match[1], 10),
    };
  }
  if (/\bhourly\b/i.test(input)) return { kind: "hourly", interval: 1 };
  if (/\bminutely\b/i.test(input)) return { kind: "minutely", interval: 1 };
  if (/\bevery\s+hour\b/i.test(input)) return { kind: "hourly", interval: 1 };
  if (/\bevery\s+minute\b/i.test(input))
    return { kind: "minutely", interval: 1 };
  return null;
}

export function parseNaturalSchedule(input: string): ParseResult {
  const defaults = scheduleFormDefaults();
  const missing: ("timing" | "task")[] = [];

  const task = extractTask(input);
  if (!task) missing.push("task");

  const intervalResult = parseInterval(input);
  if (intervalResult) {
    const days = parseDays(input) ?? [...ALL_DAYS];
    return {
      values: {
        ...defaults,
        name: task || "Scheduled task",
        task,
        kind: intervalResult.kind,
        interval: String(intervalResult.interval),
        days,
        timezone: detectTimezone(),
      },
      missing,
    };
  }

  const time = parseTime(input);
  const days = parseDays(input);

  if (!time && !days) {
    missing.push("timing");
    return {
      values: { ...defaults, name: task || "Scheduled task", task },
      missing,
    };
  }

  return {
    values: {
      ...defaults,
      name: task || "Scheduled task",
      task,
      kind: "daily",
      time: time ? `${pad(time.hour)}:${pad(time.minute)}` : "09:00",
      days: days ?? [...ALL_DAYS],
      timezone: detectTimezone(),
    },
    missing,
  };
}

export function formatScheduleSummary(values: ScheduleFormValues): string {
  const dayNames = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const dayStr =
    values.days.length === 7
      ? "every day"
      : values.days.length === 5 &&
          [1, 2, 3, 4, 5].every((d) => values.days.includes(d))
        ? "weekdays"
        : values.days.map((d) => dayNames[d - 1]).join(", ");

  switch (values.kind) {
    case "daily": {
      const [h, m] = values.time.split(":").map(Number);
      const hour12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
      const ampm = h >= 12 ? "PM" : "AM";
      const timeStr =
        m === 0 ? `${hour12} ${ampm}` : `${hour12}:${pad(m)} ${ampm}`;
      return `${dayStr} at ${timeStr}`;
    }
    case "hourly":
      return `every ${values.interval} hour${values.interval === "1" ? "" : "s"} on ${dayStr}`;
    case "minutely":
      return `every ${values.interval} minute${values.interval === "1" ? "" : "s"} on ${dayStr}`;
    case "custom":
      return `custom schedule`;
  }
}
