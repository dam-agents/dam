import { z } from "zod";
import { agentSizeSchema, storageQuantitySchema } from "../agents/schemas.js";
import {
  isProviderPresetType,
  type ProviderPresetType,
} from "../connections/providers.js";
import { knowledgeBaseTemplateIdSchema } from "../knowledge-bases/schemas.js";
import { quietWindowSchema } from "../schedules/schemas.js";
import { harnessFamilySchema } from "../templates/schemas.js";

export const starterKitIdSchema = z
  .string()
  .min(1)
  .regex(/^[a-z0-9][a-z0-9-]*$/, "lowercase letters, digits and dashes");

export const starterKitCatalogNameSchema = starterKitIdSchema;

export const starterKitCategorySchema = z.enum([
  "knowledge",
  "software",
  "productivity",
  "research",
]);

export const starterKitConnectionRequirementSchema = z.object({
  accepts: z.array(z.string().min(1)).min(1),
  required: z.boolean().default(false),
  note: z.string().optional(),
});

export const starterKitChannelSchema = z.object({
  type: z.enum(["slack", "telegram"]),
  note: z.string().optional(),
});

const scheduleCommon = {
  name: z.string().min(1),
  task: z.string().min(1),
  enabled: z.boolean().default(true),
  sessionMode: z.enum(["continuous", "fresh"]).optional(),
};

export const starterKitCronScheduleSchema = z.object({
  ...scheduleCommon,
  cron: z.string().min(1),
});

export const starterKitRRuleScheduleSchema = z.object({
  ...scheduleCommon,
  rrule: z.string().min(1),
  timezone: z.string().min(1),
});

export const starterKitScheduleSchema = z.union([
  starterKitCronScheduleSchema,
  starterKitRRuleScheduleSchema,
]);

export const starterKitExternalSkillSchema = z.object({
  source: z.url(),
  name: z.string().min(1),
});

export const starterKitBundledSkillsSchema = z.object({
  path: z.string().min(1),
});

export const resolvedSkillSchema = z.object({
  name: z.string().min(1),
  description: z.string(),
});

export const starterKitParameterSchema = z.object({
  name: z.string().min(1),
  required: z.boolean().default(false),
  note: z.string().optional(),
});

export const starterKitEnvVarSchema = z.object({
  name: z.string().min(1),
  value: z.string(),
});

const providerListSchema = z.array(
  z.custom<ProviderPresetType>(
    (v) => typeof v === "string" && isProviderPresetType(v),
    "unknown provider type",
  ),
);

export const starterKitImageSchema = z.object({
  ref: z.string().min(1),
  harness: harnessFamilySchema.optional(),
  providers: providerListSchema.optional(),
});

export const starterKitKnowledgeBaseSchema = z.object({
  template: knowledgeBaseTemplateIdSchema,
});

export const starterKitInstallSchema = z.object({
  command: z.string().min(1),
});

export const starterKitResourcesSchema = agentSizeSchema.extend({
  storage: storageQuantitySchema.optional(),
  note: z.string().min(1).optional(),
});

const harnessCommandNameSchema = z
  .string()
  .regex(/^[a-z0-9][a-z0-9:_-]*$/, "a command name without the leading slash");

export const starterKitSchema = z.object({
  schemaVersion: z.literal("v1"),
  id: starterKitIdSchema,
  name: z.string().min(1),
  description: z.string().min(1),
  tagline: z.string().min(1).optional(),
  category: starterKitCategorySchema,
  icon: z.string().min(1).optional(),
  video: z.url().optional(),
  docsUrl: z.url().optional(),
  image: starterKitImageSchema.optional(),
  resources: starterKitResourcesSchema.optional(),
  knowledgeBase: starterKitKnowledgeBaseSchema.optional(),
  install: starterKitInstallSchema.optional(),
  harnesses: z.array(harnessFamilySchema).min(1).optional(),
  providers: providerListSchema.min(1).optional(),
  seed: z
    .object({
      url: z.url(),
      ref: z.string().min(1).optional(),
      commit: z
        .string()
        .regex(/^[0-9a-f]{40}$/i)
        .optional(),
      into: z.enum(["work", "home"]).default("work"),
    })
    .optional(),
  onboarding: z
    .union([
      z.literal(false),
      z.object({ prompt: z.string().min(1) }),
      z.object({ command: harnessCommandNameSchema }),
    ])
    .optional(),
  connections: z.array(starterKitConnectionRequirementSchema).default([]),
  channels: z.array(starterKitChannelSchema).default([]),
  schedules: z.array(starterKitScheduleSchema).default([]),
  skills: z.array(starterKitExternalSkillSchema).default([]),
  bundledSkills: starterKitBundledSkillsSchema.optional(),
  env: z.array(starterKitEnvVarSchema).default([]),
  hibernationTimeoutMin: z.number().int().min(0).optional(),
  parameters: z.array(starterKitParameterSchema).default([]),
});

export const starterKitCatalogEntrySchema = z.object({
  path: z.string().min(1).default("."),
  gitUrl: z.url().optional(),
  ref: z.string().min(1).optional(),
});

export const starterKitCatalogSchema = z.object({
  kits: z.array(starterKitCatalogEntrySchema),
});

export const starterKitGetInputSchema = z.object({
  catalog: starterKitCatalogNameSchema,
  id: starterKitIdSchema,
});

export const starterKitScheduleTimingSchema = z.union([
  z.object({ cron: z.string().min(1) }),
  z.object({ rrule: z.string().min(1), timezone: z.string().min(1) }),
]);

export const starterKitScheduleOverrideSchema = z.object({
  name: z.string().min(1),
  timing: starterKitScheduleTimingSchema.optional(),
  sessionMode: z.enum(["continuous", "fresh"]).optional(),
  enabled: z.boolean().optional(),
  quietHours: z.array(quietWindowSchema).optional(),
});

export const starterKitApplyInputSchema = z.object({
  catalog: starterKitCatalogNameSchema,
  kitId: starterKitIdSchema,
  name: z
    .string()
    .min(1)
    .refine((n) => !n.startsWith("agent-"), {
      message: "agent name cannot start with 'agent-' (reserved for IDs)",
    }),
  templateId: z.string().min(1).optional(),
  connectionIds: z.array(z.string().min(1)).default([]),
  slackChannelId: z.string().min(1).optional(),
  skipSchedules: z.array(z.string().min(1)).default([]),
  scheduleOverrides: z.array(starterKitScheduleOverrideSchema).default([]),
});
