import { z } from "zod";
import {
  mountSchema,
  resourcesSchema,
  envVarSchema,
} from "../templates/schemas.js";
import { ENV_NAME_RE } from "../secrets/types.js";

export const agentSpecSchema = z
  .object({
    version: z.string(),
    name: z.string(),
    image: z.string(),
    description: z.string().optional(),
    mounts: z.array(mountSchema).optional(),
    init: z.string().optional(),
    env: z.array(envVarSchema).optional(),
    resources: resourcesSchema.optional(),
    imagePullPolicy: z.string().optional(),
    storageSize: z.string().optional(),
    skillPaths: z.array(z.string()).optional(),
    desiredState: z.enum(["running", "hibernated"]).optional(),
    secretRef: z.string().optional(),
  })
  .passthrough();

const agentEnvVarSchema = z.object({
  name: z
    .string()
    .min(1)
    .max(255)
    .regex(ENV_NAME_RE, "name must match [A-Z_][A-Z0-9_]*"),
  value: z.string().max(10000),
});

export const createAgentInputSchema = z.object({
  name: z
    .string()
    .min(1)
    .refine((n) => !n.startsWith("agent-"), {
      message: "agent name cannot start with 'agent-' (reserved for IDs)",
    }),
  templateId: z.string().optional(),
  image: z.string().optional(),
  description: z.string().optional(),
  env: z.array(agentEnvVarSchema).max(64).optional(),
  secretRef: z.string().optional(),
  allowedUserEmails: z.array(z.email()).optional(),
  egressPreset: z.enum(["none", "trusted", "all"]).optional(),
});

export type CreateAgentInput = z.infer<typeof createAgentInputSchema>;

export const updateAgentInputSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(255).optional(),
  description: z.string().optional(),
  env: z.array(agentEnvVarSchema).max(64).optional(),
  secretRef: z.string().optional(),
  allowedUserEmails: z.array(z.email()).optional(),
});

export type UpdateAgentInput = z.infer<typeof updateAgentInputSchema>;
