import { z } from "zod";

import type { Schedule } from "../../../types.js";
import { cronProblem } from "../lib/cron-conversion.js";
import { scheduleWorkFields } from "./schedule-work-fields.js";

export const cronFormSchema = z
  .object({
    ...scheduleWorkFields,
    cron: z.string().trim().min(1, "Required"),
  })
  .superRefine((v, ctx) => {
    const problem = v.cron.trim() ? cronProblem(v.cron) : null;
    if (problem)
      ctx.addIssue({
        code: "custom",
        path: ["cron"],
        message: `Not accepted: ${problem}`,
      });
  });

export type CronFormValues = z.infer<typeof cronFormSchema>;

export function cronFormDefaults(existing: Schedule): CronFormValues {
  return {
    name: existing.name,
    cron: existing.cron ?? "",
    task: existing.task ?? "",
    precheck: existing.precheck ?? "",
    harness: existing.harness ?? "",
    model: existing.model ?? "",
    settings: {
      ...existing.settings,
      ...existing.platformSubagentSettings,
    },
    profile: existing.profile ?? "",
    platformSubagentProfile: existing.platformSubagentProfile ?? "",
    sessionTitle: existing.sessionTitle ?? "",
    sessionMode: existing.sessionMode ?? "fresh",
  };
}
