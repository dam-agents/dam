import { z } from "zod";

export const featureIdSchema = z.enum([
  "advanced-connections",
  "processes",
  "vm-sandboxes",
  "session-costs",
  "chat-forms",
]);

export const featureModeSchema = z.enum(["off", "experimental", "on"]);

export const featureSetFlagInputSchema = z.object({
  feature: featureIdSchema,
  enabled: z.boolean(),
});
