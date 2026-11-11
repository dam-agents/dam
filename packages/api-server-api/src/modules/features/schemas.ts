import { z } from "zod";

export const featureIdSchema = z.enum([
  "advanced-connections",
  "agent-telemetry",
  "processes",
  "chat-forms",
  "custom-avatars",
  "environments",
  "hermes",
  "github-enterprise-hosts",
  "dambledore",
  "damConnection",
]);

export const featureModeSchema = z.enum(["off", "experimental", "on"]);

export const featureSetFlagInputSchema = z.object({
  feature: featureIdSchema,
  enabled: z.boolean(),
});
