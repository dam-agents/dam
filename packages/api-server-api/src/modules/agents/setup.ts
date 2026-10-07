import { z } from "zod";
import { agentSizeSchema, storageQuantitySchema } from "./schemas.js";

export const agentSetupInstallSchema = z.object({
  command: z.string().min(1),
});

export const agentSetupEnvVarSchema = z.object({
  name: z.string().min(1),
  value: z.string(),
});

export const agentSetupResourcesSchema = agentSizeSchema.extend({
  storage: storageQuantitySchema.optional(),
});

export const agentSetupSkillSchema = z.object({
  source: z.url(),
  name: z.string().min(1),
});

export const agentSetupSeedSchema = z.object({
  url: z.url(),
  ref: z.string().min(1).optional(),
  commit: z
    .string()
    .regex(/^[0-9a-f]{40}$/i)
    .optional(),
  into: z.enum(["work", "home"]).default("work"),
});

export const agentSetupShape = {
  backend: z.literal("vm").optional(),
  resources: agentSetupResourcesSchema.optional(),
  install: agentSetupInstallSchema.optional(),
  env: z.array(agentSetupEnvVarSchema).default([]),
  skills: z.array(agentSetupSkillSchema).default([]),
};

export const agentSetupSchema = z.object({
  ...agentSetupShape,
  seed: agentSetupSeedSchema.optional(),
});

export type AgentSetup = z.infer<typeof agentSetupSchema>;
export type AgentSetupSeed = z.infer<typeof agentSetupSeedSchema>;
export type AgentSetupResources = z.infer<typeof agentSetupResourcesSchema>;
