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

export const featureLevelSchema = z.enum(["internal", "experimental"]);

export const featureEntrySchema = z.object({
  level: featureLevelSchema,
  issue: z.number().int().positive(),
  since: z.string().regex(/^v\d+\.\d+\.\d+$/),
});

export const featureRegistrySchema = z.record(
  featureIdSchema,
  featureEntrySchema,
);

export const featureModeSchema = z.enum(["off", "user", "on"]);

export const featureSetFlagInputSchema = z.object({
  feature: featureIdSchema,
  enabled: z.boolean(),
});
