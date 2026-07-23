import {
  ALL_DAYS,
  buildRRule,
  detectPreset,
  detectTimezone,
  type FrequencyPreset,
  hasVisibleOccurrence,
  rruleToText,
} from "api-server-api";
import { z } from "zod";

import type { Schedule } from "../../../types.js";

export const scheduleFormSchema = z
  .object({
    name: z.string().trim().min(1, "Required"),
    task: z.string().trim().min(1, "Required"),
    timezone: z.string().trim().min(1, "Required"),
    sessionMode: z.enum(["fresh", "continuous"]),
    kind: z.enum(["daily", "hourly", "minutely", "custom"]),
    // Held as raw text so the field can be cleared and retyped freely;
    // parsed (and validated) only when the kind uses it.
    interval: z.string(),
    time: z.string(),
    days: z.array(z.number().int().min(1).max(7)),
    customRRule: z.string(),
    quietHours: z.array(
      z.object({
        startTime: z.string(),
        endTime: z.string(),
        enabled: z.boolean(),
      }),
    ),
  })
  .superRefine((v, ctx) => {
    if (v.kind !== "custom" && v.days.length === 0)
      ctx.addIssue({
        code: "custom",
        path: ["days"],
        message: "Pick at least one day",
      });
    if (
      (v.kind === "minutely" || v.kind === "hourly") &&
      !(Number.parseInt(v.interval, 10) >= 1)
    )
      ctx.addIssue({
        code: "custom",
        path: ["interval"],
        message: "Enter a number of 1 or more",
      });
    const { body, error } = buildRRuleParts(v);
    if (error) {
      ctx.addIssue({
        code: "custom",
        path: [v.kind === "custom" ? "customRRule" : "kind"],
        message: error,
      });
      return;
    }
    if (v.quietHours.some((q) => q.startTime === q.endTime)) {
      ctx.addIssue({
        code: "custom",
        path: ["quietHours"],
        message: "Start and end must differ",
      });
      return;
    }
    // Guard the footgun where every tick lands inside a quiet window — the
    // schedule would never fire. Only checked once the rule itself is valid.
    if (!hasVisibleOccurrence(body, v.quietHours))
      ctx.addIssue({
        code: "custom",
        path: ["quietHours"],
        message:
          "Quiet hours cover every scheduled occurrence — this schedule would never fire.",
      });
  });

export type ScheduleFormValues = z.infer<typeof scheduleFormSchema>;

function toFrequencyPreset(v: ScheduleFormValues): FrequencyPreset {
  const interval = Math.max(1, Number.parseInt(v.interval, 10) || 1);
  switch (v.kind) {
    case "minutely":
      return { kind: v.kind, interval, days: v.days };
    case "hourly":
      return { kind: v.kind, interval, days: v.days };
    case "daily": {
      const [hour = 9, minute = 0] = v.time.split(":").map(Number);
      return { kind: v.kind, hour, minute, days: v.days };
    }
    case "custom":
      return { kind: v.kind, rrule: v.customRRule };
  }
}

/** The RRULE body + human summary the current form values describe, or the
 *  build error. Drives the live cadence line and the submit payload. */
export function buildRRuleParts(v: ScheduleFormValues): {
  body: string;
  summary: string;
  error: string | null;
} {
  try {
    const body = buildRRule(toFrequencyPreset(v));
    return { body, summary: rruleToText(body), error: null };
  } catch (e) {
    return { body: "", summary: "", error: (e as Error).message };
  }
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** Default values for the form, seeded from an existing schedule when
 *  editing (recognising its RRULE via `detectPreset`). */
export function scheduleFormDefaults(existing?: Schedule): ScheduleFormValues {
  const preset: FrequencyPreset = existing?.rrule
    ? detectPreset(existing.rrule)
    : { kind: "daily", hour: 9, minute: 0, days: [...ALL_DAYS] };
  return {
    name: existing?.name ?? "",
    task: existing?.task ?? "",
    timezone: existing?.timezone ?? detectTimezone(),
    sessionMode: existing?.sessionMode ?? "fresh",
    kind: preset.kind,
    interval:
      preset.kind === "minutely" || preset.kind === "hourly"
        ? String(preset.interval)
        : "30",
    time:
      preset.kind === "daily"
        ? `${pad(preset.hour)}:${pad(preset.minute)}`
        : "09:00",
    days: preset.kind === "custom" ? [...ALL_DAYS] : preset.days,
    customRRule:
      preset.kind === "custom"
        ? preset.rrule
        : (existing?.rrule ?? "FREQ=WEEKLY;BYDAY=MO,WE;BYHOUR=7;BYMINUTE=30"),
    quietHours: existing?.quietHours ?? [],
  };
}
