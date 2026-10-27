import { SESSION_TITLE_MAX_LENGTH } from "agent-runtime-api";
import { PRECHECK_MAX_LENGTH } from "api-server-api";
import { z } from "zod";

import type { Schedule } from "../../../types.js";
import { cronProblem } from "../lib/cron-conversion.js";

export const cronFormSchema = z
  .object({
    name: z.string().trim().min(1, "Required"),
    cron: z.string().trim().min(1, "Required"),
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
    sessionMode: z.enum(["fresh", "continuous"]),
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
