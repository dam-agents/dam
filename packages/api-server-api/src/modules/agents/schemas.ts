import { z } from "zod";
import { egressPresetSchema } from "../egress-rules/schemas.js";
import { envVarSchema } from "../shared.js";

const idSchema = z.object({ id: z.string().min(1) });

const cpuQuantitySchema = z
  .string()
  .regex(/^\d+(\.\d+)?m?$/, "CPU must look like '2', '0.5' or '500m'")
  .refine((v) => toCpuMilli(v) >= 100, {
    message: "CPU must be at least 100m",
  });
const memoryQuantitySchema = z
  .string()
  .regex(/^\d+(Mi|Gi)$/, "memory must look like '512Mi' or '2Gi'")
  .refine((v) => toMemoryMi(v) >= 384, {
    message: "memory must be at least 384Mi",
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
export const agentUpgradeInputSchema = idSchema.extend({
  expectedToImage: z.string().min(1).optional(),
});
export const agentDisconnectSlackInputSchema = idSchema.extend({
  slackChannelId: z.string().min(1).optional(),
});

export const agentKindSchema = z.enum(["knowledge-base", "experiment"]);

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
    egressPreset: egressPresetSchema.optional(),
    hibernationTimeoutMin: z.number().int().min(0).optional(),
    gitRepo: z
      .object({ url: z.url(), ref: z.string().min(1).optional() })
      .optional(),
    connectionIds: z.array(z.string()).optional(),
    size: agentSizeSchema.optional(),
    sweepable: z.boolean().optional(),
    lifetimeMs: z.number().int().min(0).optional(),
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
  hibernationTimeoutMin: z.number().int().min(0).nullable().optional(),
  size: agentSizeSchema.optional(),
});

export const agentConnectSlackInputSchema = z.object({
  id: z.string().min(1),
  slackChannelId: z.string().min(1),
  ambient: z.boolean().optional(),
});

export const agentListTelegramChatsInputSchema = z.object({
  agentId: z.string().min(1),
});

export const agentUnbindTelegramChatInputSchema = z.object({
  agentId: z.string().min(1),
  conversationId: z.string().min(1),
});

export const agentBindTelegramChatInputSchema = z.object({
  agentId: z.string().min(1),
  flowId: z.string().min(1),
});

export const agentBindSlackChannelInputSchema = z.object({
  agentId: z.string().min(1),
  flowId: z.string().min(1),
});
