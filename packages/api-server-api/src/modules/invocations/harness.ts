import { z } from "zod";

import { invocationOutputSchema } from "./schemas.js";

export const SCRIPT_FAILURE_MAX_CHARS = 2_000;

export const MAX_SCRIPT_OUTPUT_BYTES = 5 * 1024 ** 3;

export const scriptUploadsInputSchema = z.object({}).strict();

export const scriptReportInputSchema = z.object({
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
  uploads(agentId: string): Promise<ScriptUploadsResult>;
  report(
    agentId: string,
    input: ScriptReportInput,
  ): Promise<ScriptReportResult>;
}
