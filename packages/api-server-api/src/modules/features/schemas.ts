import { z } from "zod";

export const featureIdSchema = z.enum([
  "advanced-connections",
  "processes",
  "vm-sandboxes",
  "session-costs",
]);

export const featureSetFlagInputSchema = z.object({
  feature: featureIdSchema,
  enabled: z.boolean(),
});
