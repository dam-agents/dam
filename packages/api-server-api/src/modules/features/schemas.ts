import { z } from "zod";

export const featureIdSchema = z.enum([
  "advanced-connections",
  "session-costs",
]);

export const featureSetFlagInputSchema = z.object({
  feature: featureIdSchema,
  enabled: z.boolean(),
});
