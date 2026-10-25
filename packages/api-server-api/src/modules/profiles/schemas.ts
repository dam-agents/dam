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

/* UNIT_BOUNDARY_DESCRIPTION: a write made from an agent names it, so an Agent
 * Editor's change lands in the owner's set — the only set that agent's
 * references resolve against. */
export const profileCreateInputSchema = profileBodySchema.extend({
  name: profileNameSchema,
  agentId: z.string().min(1).optional(),
});

export const profileUpdateInputSchema = profileBodySchema.partial().extend({
  id: z.string().min(1),
  name: profileNameSchema.optional(),
  agentId: z.string().min(1).optional(),
});

export const profileIdInputSchema = z.object({
  id: z.string().min(1),
  agentId: z.string().min(1).optional(),
});

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

/* UNIT_BOUNDARY_DESCRIPTION: asked for one agent, a profile also says whether it
 * can run there and why not, so a picker can cross it out instead of offering a
 * choice the run would refuse. */
export const profileAvailabilitySchema = z.object({
  available: z.boolean(),
  reason: z.string().nullable(),
  /* UNIT_BOUNDARY_DESCRIPTION: the owner holds a Connection of the profile's
   * provider and the agent does not, so a picker can attach it in one click
   * instead of sending the user to another page. */
  attachable: z.boolean(),
});

export const profileViewSchema = profileSchema.extend({
  usage: profileUsageCountsSchema,
  availability: profileAvailabilitySchema.nullable(),
});

export const profileListInputSchema = z
  .object({ agentId: z.string().min(1).optional() })
  .optional();

/* UNIT_BOUNDARY_DESCRIPTION: an edit reports the agents that still point at the
 * profile but cannot run what it now says, so the editor can name them instead
 * of leaving them silently on their previous pair. */
export const profileUpdateResultSchema = z.object({
  profile: profileViewSchema,
  rejected: z.array(z.object({ agentId: z.string(), reason: z.string() })),
});
