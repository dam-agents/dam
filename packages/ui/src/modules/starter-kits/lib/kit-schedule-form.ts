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

const CADENCE_FIELDS = [
  "kind",
  "interval",
  "time",
  "days",
  "customRRule",
  "timezone",
] as const satisfies readonly (keyof ScheduleFormValues)[];

function cadenceOf(values: ScheduleFormValues): string {
  return JSON.stringify(CADENCE_FIELDS.map((field) => values[field]));
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: The form speaks only recurrence rules, so a kit
 * schedule declared as cron starts from a stand-in cadence the form cannot
 * show as cron. That stand-in must never reach the created schedule: the
 * declared cron is kept until the user changes a cadence field, and only then
 * does the form's rule replace it.
 */
export function cadenceEdited(
  schedule: StarterKitSchedule,
  values: ScheduleFormValues,
): boolean {
  return (
    cadenceOf(values) !== cadenceOf(kitScheduleFormValues(schedule, undefined))
  );
}

export function keepsDeclaredCron(
  schedule: StarterKitSchedule,
  values: ScheduleFormValues,
): boolean {
  return "cron" in schedule && !cadenceEdited(schedule, values);
}

export type KitScheduleFormOverride = Omit<
  StarterKitScheduleOverride,
  "name" | "timing"
> & { timing?: { rrule: string; timezone: string } };

export function overrideFromForm(
  schedule: StarterKitSchedule,
  values: ScheduleFormValues,
  enabled: boolean,
): KitScheduleFormOverride | null {
  const { body, error } = buildRRuleParts(values);
  if (error) return null;
  return {
    ...(keepsDeclaredCron(schedule, values)
      ? {}
      : { timing: { rrule: body, timezone: values.timezone } }),
    sessionMode: values.sessionMode,
    enabled,
    quietHours: values.quietHours,
  };
}

function sameRRule(a: string, b: string): boolean {
  return JSON.stringify(detectPreset(a)) === JSON.stringify(detectPreset(b));
}

export function kitScheduleModified(
  schedule: StarterKitSchedule,
  values: ScheduleFormValues,
  enabled: boolean,
): boolean {
  const override = overrideFromForm(schedule, values, enabled);
  if (!override) return false;
  if (override.enabled !== schedule.enabled) return true;
  if (override.sessionMode !== (schedule.sessionMode ?? "fresh")) return true;
  if ((override.quietHours ?? []).length > 0) return true;
  if (!override.timing) return false;
  return (
    "cron" in schedule ||
    !sameRRule(override.timing.rrule, schedule.rrule) ||
    override.timing.timezone !== schedule.timezone
  );
}
