import { SESSION_TITLE_MAX_LENGTH } from "agent-runtime-api";
import { detectTimezone, localDateTimeIn } from "api-server-api";
import { z } from "zod";

import type { Schedule } from "../../../types.js";

const HOUR_MS = 60 * 60 * 1000;

export const onceFormSchema = z
  .object({
    name: z.string().trim().min(1, "Required"),
    task: z.string().trim().min(1, "Required"),
    when: z.enum(["now", "at"]),
    date: z.string(),
    time: z.string(),
    timezone: z.string().trim().min(1, "Required"),
    harness: z.string(),
    model: z.string(),
    settings: z.record(z.string(), z.string()),
    profile: z.string(),
    sessionTitle: z
      .string()
      .trim()
      .max(
        SESSION_TITLE_MAX_LENGTH,
        `Max ${SESSION_TITLE_MAX_LENGTH} characters`,
      ),
  })
  .superRefine((v, ctx) => {
    if (v.when !== "at") return;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v.date))
      ctx.addIssue({ code: "custom", path: ["date"], message: "Pick a date" });
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(v.time))
      ctx.addIssue({ code: "custom", path: ["time"], message: "Pick a time" });
  });

export type OnceFormValues = z.infer<typeof onceFormSchema>;

export function onceFormDefaults(existing?: Schedule): OnceFormValues {
  const timezone = existing?.timezone ?? detectTimezone();
  const moment = existing?.at
    ? new Date(existing.at)
    : new Date(Math.ceil((Date.now() + HOUR_MS) / HOUR_MS) * HOUR_MS);
  const { date, time } = localDateTimeIn(moment, timezone);
  return {
    name: existing?.name ?? "",
    task: existing?.task ?? "",
    when: existing ? "at" : "now",
    date,
    time,
    timezone,
    harness: existing?.harness ?? "",
    model: existing?.model ?? "",
    settings: existing?.settings ?? {},
    profile: existing?.profile ?? "",
    sessionTitle: existing?.sessionTitle ?? "",
  };
}

export function onceLocalMoment(v: OnceFormValues): string | undefined {
  return v.when === "at" ? `${v.date}T${v.time}` : undefined;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: the choices a one-time task's update carries. The
 * server replaces the choices it is given, so every one the form shows travels:
 * a task-only edit must not delete the harness, model and settings the task ran
 * on. A task on a profile sends the profile and no inline values, so the
 * reference stays; one on its own values sends them, and a value the user
 * cleared is left out, so the task goes back to the agent's chat default.
 */
export function onceUpdateChoices(
  v: Pick<OnceFormValues, "profile" | "harness" | "model" | "settings">,
): {
  profile?: string;
  harness?: string;
  model?: string;
  settings?: Record<string, string>;
} {
  if (v.profile) return { profile: v.profile };
  const settings = Object.fromEntries(
    Object.entries(v.settings).filter(([, value]) => value !== ""),
  );
  return {
    ...(v.harness ? { harness: v.harness } : {}),
    ...(v.model ? { model: v.model } : {}),
    ...(Object.keys(settings).length > 0 ? { settings } : {}),
  };
}
