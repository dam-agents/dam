import {
  isPlatformSubagentSetting,
  sessionSettingsSchema,
} from "agent-runtime-api";
import { z } from "zod";

export const profileNameSchema = z.string().trim().min(1).max(64);

export const profileModelSchema = z.string().trim().min(1).max(200);

/* UNIT_BOUNDARY_DESCRIPTION: a profile holds the choice a platform sub-agent
 * runs on under its own reference, so a profile's settings carry only the
 * session's own: a platform sub-agent key here would be a second, conflicting
 * answer to the same question. */
export const profileSettingsSchema = sessionSettingsSchema.refine(
  (settings) => !Object.keys(settings).some(isPlatformSubagentSetting),
  { message: "a profile's settings cannot hold platform sub-agent choices" },
);

const profileBodySchema = z.object({
  harness: z.string().trim().min(1).max(100),
  providerTemplate: z.string().trim().min(1).max(100),
  model: profileModelSchema,
  settings: profileSettingsSchema.optional(),
});

export const profileCreateInputSchema = profileBodySchema.extend({
  name: profileNameSchema,
});

export const profileUpdateInputSchema = profileBodySchema
  .partial()
  .extend({ id: z.string().min(1), name: profileNameSchema.optional() });

export const profileIdInputSchema = z.object({ id: z.string().min(1) });

export const profileSlotSchema = z.enum(["chat", "platformSubagent"]);

export const profileUsageSchema = z.object({
  agents: z.array(
    z.object({ id: z.string(), slots: z.array(profileSlotSchema) }),
  ),
  /* UNIT_BOUNDARY_DESCRIPTION: a channel row is identified by the agent and the
   * channel it binds (it carries no id), which is exactly what a usage list
   * names. */
  channels: z.array(z.object({ agentId: z.string(), label: z.string() })),
  schedules: z.array(
    z.object({ id: z.string(), name: z.string(), agentId: z.string() }),
  ),
});

export const profileUsageCountsSchema = z.object({
  agents: z.number().int().nonnegative(),
  channels: z.number().int().nonnegative(),
  schedules: z.number().int().nonnegative(),
});

export const profileSchema = z.object({
  id: z.string(),
  name: z.string(),
  harness: z.string(),
  providerTemplate: z.string(),
  model: z.string(),
  settings: z.record(z.string(), z.string()),
  seeded: z.boolean(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const profileViewSchema = profileSchema.extend({
  usage: profileUsageCountsSchema,
});

/* UNIT_BOUNDARY_DESCRIPTION: an edit reports the agents that still point at the
 * profile but cannot run what it now says, so the editor can name them instead
 * of leaving them silently on their previous pair. */
export const profileUpdateResultSchema = z.object({
  profile: profileViewSchema,
  rejected: z.array(z.object({ agentId: z.string(), reason: z.string() })),
});
