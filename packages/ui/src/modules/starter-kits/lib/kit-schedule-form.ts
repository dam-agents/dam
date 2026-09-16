import {
  ALL_DAYS,
  detectPreset,
  detectTimezone,
  type FrequencyPreset,
  type StarterKitSchedule,
  type StarterKitScheduleOverride,
} from "api-server-api";

import {
  buildRRuleParts,
  type ScheduleFormValues,
} from "../../schedules/forms/schedule-form-schema.js";

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function presetFor(
  schedule: StarterKitSchedule,
  override: StarterKitScheduleOverride | undefined,
): FrequencyPreset {
  const rrule =
    override?.timing && "rrule" in override.timing
      ? override.timing.rrule
      : "rrule" in schedule
        ? schedule.rrule
        : null;
  return rrule
    ? detectPreset(rrule)
    : { kind: "daily", hour: 9, minute: 0, days: [...ALL_DAYS] };
}

export function kitScheduleFormValues(
  schedule: StarterKitSchedule,
  override: StarterKitScheduleOverride | undefined,
): ScheduleFormValues {
  const preset = presetFor(schedule, override);
  const timezone =
    override?.timing && "rrule" in override.timing
      ? override.timing.timezone
      : "timezone" in schedule
        ? schedule.timezone
        : detectTimezone();

  return {
    name: schedule.name,
    task: schedule.task,
    timezone,
    sessionMode: override?.sessionMode ?? schedule.sessionMode ?? "fresh",
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
        : "FREQ=WEEKLY;BYDAY=MO,WE;BYHOUR=7;BYMINUTE=30",
    quietHours: override?.quietHours ?? [],
    precheck: "",
  };
}

export function kitScheduleModified(
  schedule: StarterKitSchedule,
  values: ScheduleFormValues,
  enabled: boolean,
): boolean {
  const original = overrideFromForm(
    kitScheduleFormValues(schedule, undefined),
    schedule.enabled,
  );
  return (
    JSON.stringify(overrideFromForm(values, enabled)) !==
    JSON.stringify(original)
  );
}

export function overrideFromForm(
  values: ScheduleFormValues,
  enabled: boolean,
): Omit<StarterKitScheduleOverride, "name"> | null {
  const { body, error } = buildRRuleParts(values);
  if (error) return null;
  return {
    timing: { rrule: body, timezone: values.timezone },
    sessionMode: values.sessionMode,
    enabled,
    quietHours: values.quietHours,
  };
}
