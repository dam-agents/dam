import { z } from "zod";

import { allEnvVarsValid } from "../../../components/env-vars-editor.js";

const envVarSchema = z.object({ name: z.string(), value: z.string() });

// Set fields are sorted arrays so React Hook Form's structural dirty check
// matches on content.
export const settingsSchema = z.object({
  name: z.string().trim().min(1, "Required"),
  assignedAppIds: z.array(z.string()),
  envVars: z
    .array(envVarSchema)
    .refine(allEnvVarsValid, "All env vars need a name and a value"),
  hibernationTimeoutMin: z
    .number({ message: "Enter a number of minutes (0 = never)" })
    .int()
    .nonnegative(),
  // Size (#1900) in slider units; applies on the next start.
  sizeCpuMilli: z.number().int().positive(),
  sizeMemoryMi: z.number().int().positive(),
});
export type SettingsValues = z.infer<typeof settingsSchema>;

export type SandboxSettingsStatus =
  | "no-agent"
  | "loading"
  | "not-found"
  | "ready";
