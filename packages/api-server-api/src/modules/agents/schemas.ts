import { z } from "zod";
import {
  mountSchema,
  resourcesSchema,
  envVarSchema,
} from "../templates/schemas.js";

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
