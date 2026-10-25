import {
  ALL_DAYS,
  buildRRule,
  detectPreset,
  detectTimezone,
  type FrequencyPreset,
  resolveKitSchedulePrecheck,
  type StarterKitSchedule,
  type StarterKitScheduleOverride,
} from "api-server-api";

import {
  buildRRuleParts,
  presetFormValues,
  type ScheduleFormValues,
} from "../../schedules/forms/schedule-form-schema.js";

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
  if (!rrule) return { kind: "daily", hour: 9, minute: 0, days: [...ALL_DAYS] };
  const preset = detectPreset(rrule);
  return buildRRule(preset) === stripPrefix(rrule)
    ? preset
    : { kind: "custom", rrule };
}

function stripPrefix(rrule: string): string {
  return rrule.trim().replace(/^RRULE:/i, "");
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
    ...presetFormValues(preset),
    quietHours: override?.quietHours ?? [],
    precheck: declaredPrecheck(schedule, override),
    harness: "",
    model: "",
    settings: {},
    profile: "",
    sessionTitle: "",
  };
}

function declaredPrecheck(
  schedule: StarterKitSchedule,
  override: StarterKitScheduleOverride | undefined,
): string {
  return (
    resolveKitSchedulePrecheck(schedule.precheck, override?.precheck) ?? ""
  );
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

function cadenceEdited(
  schedule: StarterKitSchedule,
  values: ScheduleFormValues,
): boolean {
  return (
    cadenceOf(values) !== cadenceOf(kitScheduleFormValues(schedule, undefined))
  );
}

export function keepsDeclaredTiming(
  schedule: StarterKitSchedule,
  values: ScheduleFormValues,
): boolean {
  return !cadenceEdited(schedule, values);
}

export function keepsDeclaredCron(
  schedule: StarterKitSchedule,
  values: ScheduleFormValues,
): boolean {
  return "cron" in schedule && keepsDeclaredTiming(schedule, values);
}

type KitScheduleFormOverride = Omit<
  StarterKitScheduleOverride,
  "name" | "timing"
> & { timing: { rrule: string; timezone: string } | undefined };

function precheckFromForm(
  schedule: StarterKitSchedule,
  values: ScheduleFormValues,
): string | null | undefined {
  const declared = schedule.precheck ?? "";
  const edited = values.precheck.trim();
  if (edited === declared.trim()) return undefined;
  return edited === "" ? null : edited;
}

export function overrideFromForm(
  schedule: StarterKitSchedule,
  values: ScheduleFormValues,
  enabled: boolean,
): KitScheduleFormOverride | null {
  const { body, error } = buildRRuleParts(values);
  if (error) return null;
  const precheck = precheckFromForm(schedule, values);
  return {
    timing: keepsDeclaredTiming(schedule, values)
      ? undefined
      : { rrule: body, timezone: values.timezone },
    sessionMode: values.sessionMode,
    enabled,
    quietHours: values.quietHours,
    ...(precheck === undefined ? {} : { precheck }),
  };
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
  if (precheckFromForm(schedule, values) !== undefined) return true;
  return override.timing !== undefined;
}
