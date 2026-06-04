import { z } from "zod";

import { allEnvVarsValid } from "../../../components/env-vars-editor.js";

const envVarSchema = z.object({
  name: z.string(),
  value: z.string(),
});

/**
 * Set fields are stored as sorted arrays so React Hook Form's structural
 * equality check (used for `isDirty` / `dirtyFields`) matches on content and
 * not on Set identity. Toggle handlers must sort before writing.
 */
export const configureAgentSchema = z.object({
  name: z.string().trim().min(1, "Required"),
  description: z.string().trim(),
  assigned: z.array(z.string()),
  assignedAppIds: z.array(z.string()),
  envVars: z
    .array(envVarSchema)
    .refine(allEnvVarsValid, "All env vars need a name and a value"),
});

export type ConfigureAgentValues = z.infer<typeof configureAgentSchema>;
