import { z } from "zod";

/**
 * UNIT_BOUNDARY_DESCRIPTION: the three results the onboarding design counts as the
 * person having got something out of the platform, as the assistant reports them.
 */
export const firstResultKindSchema = z.enum([
  "schedule",
  "artifact",
  "knowledgeBase",
]);

export const assistantFirstResultInputSchema = z.object({
  kind: firstResultKindSchema,
  ref: z.string().min(1).max(500).optional(),
});
