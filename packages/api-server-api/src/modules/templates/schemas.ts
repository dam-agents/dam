import { z } from "zod";
import { skillSourcePathSchema } from "../skills/schemas.js";

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
  path: skillSourcePathSchema.optional(),
});

export const templateCategorySchema = z
  .enum(["harness", "preconfigured"])
  .default("harness");

export const templateSpecSchema = z
  .object({
    version: z.string(),
    image: z.string(),
    name: z.string().optional(),
    description: z.string().optional(),
    category: templateCategorySchema,
    tags: z.array(z.string()).optional(),
    docsUrl: z.string().optional(),
    setupNote: z.object({ title: z.string(), body: z.string() }).optional(),
    experimental: z.boolean().optional(),
    mounts: z.array(mountSchema).optional(),
    init: z.string().optional(),
    env: z.array(envVarConfigMapSchema).optional(),
    resources: resourcesSchema.optional(),
    imagePullPolicy: z.string().optional(),
    // Names a kubernetes.io/dockerconfigjson Secret in the agent namespace,
    // pre-created by the chart for templates that pull from a private registry
    // (e.g. experimental external agents). Carried onto the agent spec so the
    // pod can pull the image without the user entering registry credentials.
    imagePullSecretRef: z.string().optional(),
    // Seeds the created agent's per-agent hibernation override (Go duration):
    // "0s" never hibernates, omitted inherits the chart-wide default. A user's
    // explicit choice at create time still wins over this.
    hibernationTimeout: z.string().optional(),
    storageSize: z.string().optional(),
    runtimeClassName: z.string().optional(),
    nodeSelector: z.record(z.string(), z.string()).optional(),
    skillSources: z.array(skillSourceSeedSchema).optional(),
  })
  .passthrough();
