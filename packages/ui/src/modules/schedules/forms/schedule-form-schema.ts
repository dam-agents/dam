import { isPlatformSubagentSetting } from "agent-runtime-api";
import { SESSION_TITLE_MAX_LENGTH } from "agent-runtime-api";
import type { SessionChoiceSlots, SessionPair } from "api-server-api";
import {
  ALL_DAYS,
  buildRRule,
  detectPreset,
  detectTimezone,
  type FrequencyPreset,
  hasVisibleOccurrence,
  PRECHECK_MAX_LENGTH,
  rruleNextFire,
  rruleToText,
} from "api-server-api";
import { z } from "zod";

import type { Schedule } from "../../../types.js";

export const scheduleFormSchema = z
  .object({
    name: z.string().trim().min(1, "Required"),
    task: z.string().trim().min(1, "Required"),
    precheck: z
      .string()
      .trim()
      .max(PRECHECK_MAX_LENGTH, `Max ${PRECHECK_MAX_LENGTH} characters`),
    harness: z.string(),
    model: z.string(),
    settings: z.record(z.string(), z.string()),
    profile: z.string(),
    platformSubagentProfile: z.string(),
    sessionTitle: z
      .string()
      .trim()
      .max(
        SESSION_TITLE_MAX_LENGTH,
        `Max ${SESSION_TITLE_MAX_LENGTH} characters`,
      ),
    timezone: z.string().trim().min(1, "Required"),
    sessionMode: z.enum(["fresh", "continuous"]),
    kind: z.enum(["daily", "hourly", "minutely", "custom"]),
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
    const { body, error } = buildRRuleParts(v);
    if (error) {
      ctx.addIssue({
        code: "custom",
        path: [errorField(v.kind)],
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
    if (!hasVisibleOccurrence(body, v.timezone, v.quietHours))
      ctx.addIssue({
        code: "custom",
        path: ["quietHours"],
        message:
          "Quiet hours cover every scheduled occurrence — this schedule would never fire.",
      });
  });

export type ScheduleFormValues = z.infer<typeof scheduleFormSchema>;

export function errorField(
  kind: ScheduleFormValues["kind"],
): "customRRule" | "interval" | "kind" {
  if (kind === "custom") return "customRRule";
  return kind === "minutely" || kind === "hourly" ? "interval" : "kind";
}

function toFrequencyPreset(v: ScheduleFormValues): FrequencyPreset {
  const interval = Number(v.interval);
  if (
    (v.kind === "minutely" || v.kind === "hourly") &&
    !(v.interval.trim() !== "" && Number.isInteger(interval) && interval >= 1)
  )
    throw new Error("Enter a whole number of 1 or more");
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

export function buildRRuleParts(v: ScheduleFormValues): {
  body: string;
  summary: string;
  error: string | null;
} {
  try {
    const body = buildRRule(toFrequencyPreset(v));
    const serverCheckOnly = !("Temporal" in globalThis);
    const next = serverCheckOnly
      ? null
      : rruleNextFire(body, v.timezone, Temporal.Now.instant(), []);
    if (next?.kind === "stopped")
      return { body: "", summary: "", error: `Not accepted: ${next.reason}` };
    return { body, summary: rruleToText(body), error: null };
  } catch (e) {
    return { body: "", summary: "", error: (e as Error).message };
  }
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

const DEFAULT_RRULE = "FREQ=WEEKLY;BYDAY=MO,WE;BYHOUR=7;BYMINUTE=30";

export function presetFormValues(
  preset: FrequencyPreset,
  customRRuleFallback = DEFAULT_RRULE,
): Pick<
  ScheduleFormValues,
  "kind" | "interval" | "time" | "days" | "customRRule"
> {
  return {
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
    customRRule: preset.kind === "custom" ? preset.rrule : customRRuleFallback,
  };
}

type ChoiceValues = {
  profile?: string | null;
  harness?: string | null;
  model?: string | null;
  settings?: Record<string, string> | null;
  platformSubagentProfile?: string | null;
};

/** UNIT_BOUNDARY_DESCRIPTION: a schedule's choices as a save sends them, in the chat default's shape: its profile with only the subagent's own values beside it, so values the profile resolves to are never taken for a detach, or its own values with the profile cleared; the subagent reference always named. A recurring update clears an empty choice with null; a create or a one-time update, whose contract clears what it leaves out, omits it. */
export function scheduleChoices(
  v: ChoiceValues,
  clear: true,
):
  | {
      profile: string;
      settings?: Record<string, string>;
      platformSubagentProfile: string | null;
    }
  | {
      profile: null;
      harness: string | null;
      model: string | null;
      settings: Record<string, string> | null;
      platformSubagentProfile: string | null;
    };
export function scheduleChoices(
  v: ChoiceValues,
  clear: false,
):
  | {
      profile: string;
      settings?: Record<string, string>;
      platformSubagentProfile: string | null;
    }
  | {
      profile: null;
      harness?: string;
      model?: string;
      settings?: Record<string, string>;
      platformSubagentProfile: string | null;
    };
export function scheduleChoices(v: ChoiceValues, clear: boolean) {
  const platformSubagentProfile = v.platformSubagentProfile || null;
  const settings = Object.fromEntries(
    Object.entries(v.settings ?? {}).filter(
      ([id, value]) =>
        value !== "" &&
        !(platformSubagentProfile && isPlatformSubagentSetting(id)),
    ),
  );
  if (v.profile) {
    const own = Object.fromEntries(
      Object.entries(settings).filter(([id]) => isPlatformSubagentSetting(id)),
    );
    return {
      profile: v.profile,
      platformSubagentProfile,
      ...(Object.keys(own).length > 0 && { settings: own }),
    };
  }
  const values = {
    harness: v.harness?.trim() || null,
    model: v.model?.trim() || null,
    settings: Object.keys(settings).length > 0 ? settings : null,
  };
  return {
    profile: null,
    platformSubagentProfile,
    ...(clear
      ? values
      : Object.fromEntries(
          Object.entries(values).filter(([, value]) => value !== null),
        )),
  };
}

type ChoiceFields = {
  profile: string;
  harness: string;
  model: string;
  settings: Record<string, string>;
  platformSubagentProfile: string;
};

const settingsPart = (settings: Record<string, string>, subagent: boolean) =>
  Object.fromEntries(
    Object.entries(settings).filter(
      ([id]) => isPlatformSubagentSetting(id) === subagent,
    ),
  );

/** UNIT_BOUNDARY_DESCRIPTION: the schedule form's choice fields as the chat default's two slots the picker shows: the form keeps the subagent's own values in its settings, as a chat pair does. */
export function scheduleSlots(v: ChoiceFields): SessionChoiceSlots {
  const subagent = settingsPart(v.settings, true);
  return {
    profileId: v.profile || null,
    pair:
      !v.profile && v.harness
        ? {
            harness: v.harness,
            provider: null,
            model: v.model || null,
            settings: settingsPart(v.settings, false),
          }
        : null,
    platformSubagentProfileId: v.platformSubagentProfile || null,
    platformSubagentSettings:
      !v.platformSubagentProfile && Object.keys(subagent).length > 0
        ? subagent
        : null,
  };
}

/** UNIT_BOUNDARY_DESCRIPTION: the slots a pick leaves, back in the form's fields, with the picked pair's harness and model kept beside a profile so a later detach starts from what it ran on. */
export function scheduleFields(
  slots: SessionChoiceSlots,
  pair: SessionPair,
): ChoiceFields {
  return {
    profile: slots.profileId ?? "",
    harness: pair.harness,
    model: pair.model ?? "",
    settings: {
      ...slots.pair?.settings,
      ...slots.platformSubagentSettings,
    },
    platformSubagentProfile: slots.platformSubagentProfileId ?? "",
  };
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: whether a schedule follows the agent's chat default
 * because it was written before profiles — no profile, no harness, no model —
 * which is the one case where the form keeps the empty choice so the row opens
 * and saves untouched (D123).
 */
export function scheduleInheritsChoices(
  existing: Schedule | undefined,
): boolean {
  return (
    existing !== undefined &&
    existing.profile === null &&
    !existing.harness &&
    !existing.model
  );
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: why a routed schedule's Custom selection cannot
 * save: it names no model. Only a row written before profiles that still
 * follows the chat default, with no harness of its own either, saves without
 * one (D123); null when the save may go ahead.
 */
export function customChoiceError(
  v: ChoiceValues,
  existing: Schedule | undefined,
  routed: boolean,
): string | null {
  if (!routed || v.profile || v.model?.trim()) return null;
  return scheduleInheritsChoices(existing) && !v.harness?.trim()
    ? null
    : "Pick a model for this schedule, or a profile.";
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: quiet hours travel on an edit only when they
 * differ from the stored list, as every other choice does: an untouched list
 * leaves the stored one alone, and one the user emptied clears it. Compared
 * by value, not by the form's dirty tracking, which misses an added or
 * removed row unless something read it while rendering.
 */
export function quietHoursChange(
  v: Pick<ScheduleFormValues, "quietHours">,
  existing: Pick<Schedule, "quietHours">,
): Partial<Pick<ScheduleFormValues, "quietHours">> {
  const key = (rows: ScheduleFormValues["quietHours"]) =>
    JSON.stringify(rows.map((r) => [r.startTime, r.endTime, r.enabled]));
  return key(v.quietHours) === key(existing.quietHours ?? [])
    ? {}
    : { quietHours: v.quietHours };
}

export function scheduleFormDefaults(existing?: Schedule): ScheduleFormValues {
  const preset: FrequencyPreset = existing?.rrule
    ? detectPreset(existing.rrule)
    : { kind: "daily", hour: 9, minute: 0, days: [...ALL_DAYS] };
  return {
    name: existing?.name ?? "",
    task: existing?.task ?? "",
    precheck: existing?.precheck ?? "",
    harness: existing?.harness ?? "",
    model: existing?.model ?? "",
    settings: {
      ...existing?.settings,
      ...existing?.platformSubagentSettings,
    },
    profile: existing?.profile ?? "",
    platformSubagentProfile: existing?.platformSubagentProfile ?? "",
    sessionTitle: existing?.sessionTitle ?? "",
    timezone: existing?.timezone ?? detectTimezone(),
    sessionMode: existing?.sessionMode ?? "fresh",
    ...presetFormValues(preset, existing?.rrule ?? undefined),
    quietHours: existing?.quietHours ?? [],
  };
}
