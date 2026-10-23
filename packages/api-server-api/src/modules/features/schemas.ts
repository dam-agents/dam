import { z } from "zod";

export const featureIdSchema = z.enum([
  "advanced-connections",
  "interactive-artifacts",
  "agent-telemetry",
  "processes",
  "chat-forms",
  "custom-avatars",
  "new-layout",
  "unified-right-toolbar",
  "environments",
]);

export const featureModeSchema = z.enum(["off", "experimental", "on"]);

export const featureSetFlagInputSchema = z.object({
  feature: featureIdSchema,
  enabled: z.boolean(),
});
