import { z } from "zod";
import { egressPresetSchema } from "../egress-rules/schemas.js";
import { envVarSchema } from "../shared.js";

const idSchema = z.object({ id: z.string().min(1) });

// CPU as cores ("2") or millicores ("500m"); memory as Mi/Gi. Deliberately
// narrower than the full K8s quantity grammar — these are slider outputs,
// not operator YAML. Floors keep a chosen size schedulable.
const cpuQuantitySchema = z
  .string()
  .regex(/^\d+(\.\d+)?m?$/, "CPU must look like '2', '0.5' or '500m'")
  .refine((v) => toCpuMilli(v) >= 100, {
    message: "CPU must be at least 100m",
  });
const memoryQuantitySchema = z
  .string()
  .regex(/^\d+(Mi|Gi)$/, "memory must look like '512Mi' or '2Gi'")
  .refine((v) => toMemoryMi(v) >= 128, {
    message: "memory must be at least 128Mi",
  });

function toCpuMilli(v: string): number {
  return v.endsWith("m") ? Number(v.slice(0, -1)) : Number(v) * 1000;
}
function toMemoryMi(v: string): number {
  return v.endsWith("Gi")
    ? Number(v.slice(0, -2)) * 1024
    : Number(v.slice(0, -2));
}

export const agentSizeSchema = z.object({
  cpu: cpuQuantitySchema.optional(),
  memory: memoryQuantitySchema.optional(),
});

export const agentGetInputSchema = idSchema;
export const agentDeleteInputSchema = idSchema;
export const agentRestartInputSchema = idSchema;
export const agentWakeInputSchema = idSchema;
export const agentStopInputSchema = idSchema;
export const agentPauseInputSchema = idSchema;
export const agentDisconnectSlackInputSchema = idSchema;

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
    // Initial connection grants, settled into the spec at create so credentials
    // ride the first snapshot and the gateway renders its chains once (no
    // readiness flap).
    connectionIds: z.array(z.string()).optional(),
    // The agent's size (#1900): CPU/memory limits, the user-facing "power"
    // knob the Budget bounds (the UI renders it as sliders). Omitted
    // dimensions inherit the template's limits, else the chart default.
    // Requests are derived server-side — never a user concept. Floors match
    // the chart's derivation floors; the budget gate is the only ceiling.
    size: agentSizeSchema.optional(),
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
  // Resize (#1900). On a sleeping sandbox the new Size rides the next start
  // through the budget gate; on a running one the increase is gated
  // server-side and the pod restarts to apply it.
  size: agentSizeSchema.optional(),
});

export const agentConnectSlackInputSchema = z.object({
  id: z.string().min(1),
  slackChannelId: z.string().min(1),
});

export const agentBindTelegramChatInputSchema = z.object({
  agentId: z.string().min(1),
  // Opaque bind-flow id minted by the Telegram OAuth callback.
  flowId: z.string().min(1),
});

// The Agent CR spec shape is the generated AgentSpecCR (crd-types.gen.ts, from
// the controller's CRD); the public AgentSpec (types.ts) derives from it. K8s
// validates it at admission, so there's no Zod re-validation here.
