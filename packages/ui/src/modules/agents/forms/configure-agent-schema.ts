import { z } from "zod";

/**
 * Set fields are stored as sorted arrays so React Hook Form's structural
 * equality check (used for `isDirty` / `dirtyFields`) matches on content and
 * not on Set identity. Toggle handlers must sort before writing.
 */
export const configureAgentSchema = z.object({
  name: z.string().trim().min(1, "Required"),
  assigned: z.array(z.string()),
  assignedAppIds: z.array(z.string()),
});

export type ConfigureAgentValues = z.infer<typeof configureAgentSchema>;
