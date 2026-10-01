import { z } from "zod";

export const featureIdSchema = z.enum([
  "advanced-connections",
  "vm-sandboxes",
  "session-costs",
  "interactive-artifacts",
  "agent-telemetry",
  "agent-avatars",
  "strict-connection-addressing",
]);

export const featureSetFlagInputSchema = z.object({
  feature: featureIdSchema,
  enabled: z.boolean(),
});
