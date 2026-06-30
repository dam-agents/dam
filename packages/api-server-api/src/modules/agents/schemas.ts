import { z } from "zod";
import { egressPresetSchema } from "../egress-rules/schemas.js";
import { envVarSchema } from "../shared.js";

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
    registryCredential: z
      .object({
        server: z.string().min(1),
        username: z.string().min(1),
        password: z.string().min(1),
      })
      .optional(),
    allowedUserEmails: z.array(z.email()).optional(),
    egressPreset: egressPresetSchema.optional(),
    // Per-agent idle timeout override in minutes (0 = never hibernate); omit to inherit the global default.
    hibernationTimeoutMin: z.number().int().min(0).optional(),
    // Optional: clone this public repo (optionally a branch/tag via `ref`) into
    // the work dir once, via a one-shot `workspace-seed` event. Not enforced
    // against the `gitRepos` catalog server-side — the clone runs in the
    // egress-gated agent pod, so this reaches no URL the agent couldn't already
    // reach itself.
    gitRepo: z
      .object({ url: z.url(), ref: z.string().min(1).optional() })
      .optional(),
    // Initial grants, settled into the spec at create so credentials ride the
    // first snapshot and the gateway renders its chains once (no readiness flap).
    secretIds: z.array(z.string()).optional(),
    connectionIds: z.array(z.string()).optional(),
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
  // Per-agent idle timeout override in minutes (0 = never hibernate); null clears it back to the global default.
  hibernationTimeoutMin: z.number().int().min(0).nullable().optional(),
});

export const agentConnectSlackInputSchema = z.object({
  id: z.string().min(1),
  slackChannelId: z.string().min(1),
});

export const agentConnectTelegramInputSchema = z.object({
  id: z.string().min(1),
  botToken: z.string().min(1),
});

// The Agent CR spec shape is the generated AgentSpecCR (crd-types.gen.ts, from
// the controller's CRD); the public AgentSpec (types.ts) derives from it. K8s
// validates it at admission, so there's no Zod re-validation here.
