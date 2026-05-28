import { z } from "zod";

export const templateGetInputSchema = z.object({
  id: z.string().min(1),
});

export const mountSchema = z.object({
  path: z.string(),
  persist: z.boolean(),
  size: z.string().optional(),
});

export const resourcesSchema = z.object({
  requests: z.record(z.string(), z.string()).optional(),
  limits: z.record(z.string(), z.string()).optional(),
});

// Loose schema for parsing ConfigMap-stored env entries. Looser than
// the user-input `envVarSchema` in `../shared.ts` because data already
// inside a ConfigMap was written by code we trust and may predate the
// stricter user-input rules.
const envVarConfigMapSchema = z.object({
  name: z.string(),
  value: z.string(),
});

export const skillSourceSeedSchema = z.object({
  name: z.string(),
  gitUrl: z.string(),
});

export const templateSpecSchema = z
  .object({
    version: z.string(),
    image: z.string(),
    description: z.string().optional(),
    mounts: z.array(mountSchema).optional(),
    init: z.string().optional(),
    env: z.array(envVarConfigMapSchema).optional(),
    resources: resourcesSchema.optional(),
    imagePullPolicy: z.string().optional(),
    storageSize: z.string().optional(),
    skillPaths: z.array(z.string()).optional(),
    skillSources: z.array(skillSourceSeedSchema).optional(),
  })
  .passthrough();
