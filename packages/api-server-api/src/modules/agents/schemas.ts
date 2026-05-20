import { z } from "zod";
import { envVarSchema } from "../shared.js";
import { mountSchema, resourcesSchema } from "../templates/schemas.js";

// TODO(#195, sub-issue 06): move to egress-rules/schemas.ts once that
// module's schemas are extracted; egress-rules is its conceptual owner.
// Transient on create: bulk-seeds egress_rules and is then forgotten — the
// preset is not stored on the agent spec; its `source` on the seeded rules
// is the truth. Defaults to `trusted` so a brand-new agent can reach
// Anthropic, npm, PyPI, GitHub, etc. without per-host inbox prompts. To
// switch presets later, call `egressRules.applyPreset`.
const egressPresetSchema = z.enum(["none", "trusted", "all"]);

const idSchema = z.object({ id: z.string().min(1) });

export const agentGetInputSchema = idSchema;
export const agentDeleteInputSchema = idSchema;
export const agentRestartInputSchema = idSchema;
export const agentWakeInputSchema = idSchema;
export const agentDisconnectSlackInputSchema = idSchema;
export const agentDisconnectTelegramInputSchema = idSchema;

export const agentCreateInputSchema = z
  .object({
    name: z
      .string()
      .min(1)
      .refine((n) => !n.startsWith("agent-"), {
        message: "agent name cannot start with 'agent-' (reserved for IDs)",
      }),
    templateId: z.string().optional(),
    image: z.string().optional(),
    description: z.string().optional(),
    env: z.array(envVarSchema).max(64).optional(),
    secretRef: z.string().optional(),
    allowedUserEmails: z.array(z.email()).optional(),
    egressPreset: egressPresetSchema.optional(),
  })
  .refine((d) => d.templateId !== undefined || d.image !== undefined, {
    message: "Either templateId or image is required",
  });

export const agentUpdateInputSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(255).optional(),
  description: z.string().optional(),
  env: z.array(envVarSchema).max(64).optional(),
  secretRef: z.string().optional(),
  allowedUserEmails: z.array(z.email()).optional(),
});

export const agentConnectSlackInputSchema = z.object({
  id: z.string().min(1),
  slackChannelId: z.string().min(1),
});

export const agentConnectTelegramInputSchema = z.object({
  id: z.string().min(1),
  botToken: z.string().min(1),
});

// Loose schema for parsing ConfigMap-stored env entries. Looser than
// `envVarSchema` (which guards the user-input boundary) because data
// already inside a ConfigMap was written by code we trust and may
// predate the stricter user-input rules.
const envVarConfigMapSchema = z.object({
  name: z.string(),
  value: z.string(),
});

export const agentSpecSchema = z
  .object({
    version: z.string(),
    name: z.string(),
    image: z.string(),
    description: z.string().optional(),
    mounts: z.array(mountSchema).optional(),
    init: z.string().optional(),
    env: z.array(envVarConfigMapSchema).optional(),
    resources: resourcesSchema.optional(),
    imagePullPolicy: z.string().optional(),
    storageSize: z.string().optional(),
    skillPaths: z.array(z.string()).optional(),
    desiredState: z.enum(["running", "hibernated"]).optional(),
    secretRef: z.string().optional(),
  })
  .passthrough();
