import { detectTimezone } from "api-server-api";
import { z } from "zod";

import type { Schedule } from "../../../types.js";
import { localDateTimeIn } from "../lib/once-schedule.js";

const HOUR_MS = 60 * 60 * 1000;

export const onceFormSchema = z
  .object({
    name: z.string().trim().min(1, "Required"),
    task: z.string().trim().min(1, "Required"),
    when: z.enum(["now", "at"]),
    date: z.string(),
    time: z.string(),
    timezone: z.string().trim().min(1, "Required"),
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
  };
}

export function onceLocalMoment(v: OnceFormValues): string | undefined {
  return v.when === "at" ? `${v.date}T${v.time}` : undefined;
}
