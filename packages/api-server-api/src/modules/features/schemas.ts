import { z } from "zod";

export const featureIdSchema = z.enum([
  "advanced-connections",
  "processes",
  "custom-avatars",
  "environments",
  "hermes",
  "github-enterprise-hosts",
  "dambledore",
  "damConnection",
  "chat-network-approvals",
  "one-time-tasks",
  "security-check",
  "mcp-tool-approval",
]);

export const featureModeSchema = z.enum(["off", "experimental", "on"]);

export const featureSetFlagInputSchema = z.object({
  feature: featureIdSchema,
  enabled: z.boolean(),
});
