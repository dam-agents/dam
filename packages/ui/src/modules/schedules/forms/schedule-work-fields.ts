import { SESSION_TITLE_MAX_LENGTH } from "agent-runtime-api";
import { PRECHECK_MAX_LENGTH } from "api-server-api";
import { z } from "zod";

/** UNIT_BOUNDARY_DESCRIPTION: the fields every schedule form collects about the work the schedule starts — its name, prompt, precheck and chat choices — shared by the recurring and the cron form, which each add only their own time fields and their own validation. */
export const scheduleWorkFields = {
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
  sessionMode: z.enum(["fresh", "continuous"]),
};
