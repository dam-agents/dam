import { z } from "zod";

import { invocationOutputSchema } from "./schemas.js";

export const SCRIPT_FAILURE_MAX_CHARS = 2_000;

export const MAX_SCRIPT_OUTPUT_BYTES = 5 * 1024 ** 3;

// UNIT_BOUNDARY_DESCRIPTION: `run` is the id of the task event that started the script, so an upload or report from an earlier run of a kept or clean slate target is refused; a runtime from before runs had ids sends none.
export const scriptUploadsInputSchema = z
  .object({ run: z.string().min(1).optional() })
  .strict();

export const scriptReportInputSchema = z.object({
  run: z.string().min(1).optional(),
  exitCode: z.number().int().nullable(),
  failure: z.string().min(1).max(SCRIPT_FAILURE_MAX_CHARS).optional(),
  output: invocationOutputSchema,
});

export type ScriptReportInput = z.infer<typeof scriptReportInputSchema>;

export type ScriptUploadsResult =
  | { outcome: "upload"; stdout: string; stderr: string }
  | { outcome: "refused"; reason: string };

export type ScriptReportResult =
  { outcome: "recorded" } | { outcome: "refused"; reason: string };

export interface InvocationScriptReports {
  uploads(agentId: string, run?: string): Promise<ScriptUploadsResult>;
  report(
    agentId: string,
    input: ScriptReportInput,
  ): Promise<ScriptReportResult>;
}
