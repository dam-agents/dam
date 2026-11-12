import {
  isPlatformSubagentSetting,
  sessionSettingsSchema,
} from "agent-runtime-api";
import { z } from "zod";
import { sessionPairSchema } from "../harness-config/schemas.js";

export const PROFILE_NAME_MAX_LENGTH = 64;

const profileNameSchema = z.string().trim().min(1).max(PROFILE_NAME_MAX_LENGTH);

/* UNIT_BOUNDARY_DESCRIPTION: the platform sub-agent slot is its own reference on
 * the agent, so a profile's settings never answer it a second time. */
const profileSettingsSchema = sessionSettingsSchema.refine(
  (settings) =>
    Object.entries(settings).every(
      ([id, value]) => !isPlatformSubagentSetting(id) && value.trim() !== "",
    ),
  { message: "a profile holds only non-empty session settings" },
);

/* UNIT_BOUNDARY_DESCRIPTION: the platform sub-agent a profile names, which a
 * slot following the profile resolves to while its own sub-agent slot is
 * empty; null or absent is "Same as agent", the harness picking. */
const profileSubagentSchema = z.object({
  providerTemplate: z.string().trim().min(1).max(100),
  model: z.string().trim().min(1).max(200),
});

const profileBodySchema = z.object({
  harness: z.string().trim().min(1).max(100),
  providerTemplate: z.string().trim().min(1).max(100),
  model: z.string().trim().min(1).max(200),
  settings: profileSettingsSchema.optional(),
  subagent: profileSubagentSchema.nullable().optional(),
});

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

export const profileUsageSchema = z.object({
  agents: z.array(z.object({ id: z.string() })),
  channels: z.array(z.object({ agentId: z.string(), label: z.string() })),
  schedules: z.array(
    z.object({ id: z.string(), name: z.string(), agentId: z.string() }),
  ),
  artifacts: z
    .array(z.object({ id: z.string(), title: z.string(), agentId: z.string() }))
    .optional(),
});

const count = z.number().int().nonnegative();

export const profileViewSchema = z.object({
  id: z.string(),
  name: z.string(),
  harness: z.string(),
  providerTemplate: z.string(),
  model: z.string(),
  subagent: profileSubagentSchema.nullable(),
  settings: z.record(z.string(), z.string()),
  usage: z.object({
    agents: count,
    channels: count,
    schedules: count,
    artifacts: count.optional(),
  }),
  /* UNIT_BOUNDARY_DESCRIPTION: asked for one agent, whether the profile runs
   * there; `attachable` is a provider the owner holds and the agent does not,
   * which a pick grants first. */
  availability: z
    .object({
      available: z.boolean(),
      reason: z.string().nullable(),
      attachable: z.boolean(),
    })
    .nullable(),
});

/* UNIT_BOUNDARY_DESCRIPTION: the default for new agents an owner chose in
 * Settings, a profile or values of their own, which a new agent's chat default
 * is initialised from; `base` is what a new agent starts on while they chose
 * neither, null where the install offers none. */
export const newAgentDefaultSchema = z.object({
  profileId: z.string().nullable(),
  pair: sessionPairSchema.nullable(),
  base: sessionPairSchema.nullable(),
});

export const setNewAgentDefaultInputSchema = z.union([
  z.object({ profileId: z.string().min(1) }),
  z.object({
    pair: sessionPairSchema.extend({
      provider: z.string().min(1),
      model: z.string().min(1),
    }),
  }),
]);

export const profileListInputSchema = z
  .object({ agentId: z.string().min(1).optional() })
  .optional();
