import { z } from "zod";

export const featureIdSchema = z.enum([
  "advanced-connections",
  "interactive-artifacts",
  "agent-telemetry",
  "processes",
  "chat-forms",
  "custom-avatars",
  "environments",
  "hermes",
  "dambledore",
]);

export const featureModeSchema = z.enum(["off", "experimental", "on"]);

export const featureSetFlagInputSchema = z.object({
  feature: featureIdSchema,
  enabled: z.boolean(),
});
