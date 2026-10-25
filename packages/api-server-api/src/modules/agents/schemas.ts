import { harnessFamilySchema } from "../templates/schemas.js";
import { z } from "zod";
import {
  AVATAR_CHARACTERS,
  AVATAR_EMOJI_RE,
  AVATAR_IMAGE_RE,
} from "./avatar/svg.js";
import { egressPresetSchema } from "../egress-rules/schemas.js";
import { envVarSchema } from "../shared.js";
import {
  VIEWER_ALLOWLIST_MAX,
  viewerEmailSchema,
} from "../artifact-library/schemas.js";

const idSchema = z.object({ id: z.string().min(1) });

function toMemoryMi(v: string): number {
  return v.endsWith("Gi")
    ? Number(v.slice(0, -2)) * 1024
    : Number(v.slice(0, -2));
}

export const storageQuantitySchema = z
  .string()
  .regex(/^\d+(Mi|Gi)$/, "storage must look like '512Mi' or '10Gi'")
  .refine((v) => toMemoryMi(v) >= 1024, {
    message: "storage must be at least 1Gi",
  });

export const agentListInputSchema = z
  .object({ scope: z.enum(["mine", "all"]) })
  .optional();
export const agentGetInputSchema = idSchema;
export const agentSetEditorsInputSchema = z.object({
  id: z.string().min(1),
  editors: z
    .array(viewerEmailSchema)
    .max(VIEWER_ALLOWLIST_MAX)
    .transform((emails) => [...new Set(emails)]),
});
export const agentLeaveInputSchema = idSchema;
export const agentBackgroundWorkInputSchema = idSchema;
export const agentDeleteInputSchema = idSchema;
export const agentRestartInputSchema = idSchema;
export const agentWakeInputSchema = idSchema;
export const agentRetryWorkspaceInputSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(["workspace-seed", "workspace-command"]),
});
export const agentSleepInputSchema = idSchema;
export const agentSetDisabledInputSchema = idSchema.extend({
  disabled: z.boolean(),
});
export const agentUpgradeInputSchema = idSchema.extend({
  expectedToImage: z.string().min(1).optional(),
});
export const agentDisconnectSlackInputSchema = idSchema.extend({
  slackChannelId: z.string().min(1).optional(),
});

export const avatarSchema = z.union([
  z.enum(AVATAR_CHARACTERS),
  z.string().regex(AVATAR_EMOJI_RE),
  z.string().regex(AVATAR_IMAGE_RE),
]);

export const agentKindSchema = z.enum(["knowledge-base"]);

export const AGENT_ID_RE = /^agent-[0-9a-f]{16}$/;

export const agentNameSchema = z
  .string()
  .min(1)
  .refine((n) => !AGENT_ID_RE.test(n), {
    message: "agent name cannot have the shape of an agent ID",
  });

export const agentCreateInputSchema = z.object({
  kbShareRoots: z.array(z.string().min(1)).min(1).max(20).optional(),
  name: agentNameSchema,
  templateId: z.string().optional(),
  image: z.string().optional(),
  harness: harnessFamilySchema.optional(),
  description: z.string().optional(),
  avatar: avatarSchema.optional(),
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
  requireConnectionAddress: z.boolean().optional(),
  gitRepo: z
    .object({
      url: z.url(),
      ref: z.string().min(1).optional(),
      commit: z.string().min(1).optional(),
      branch: z.string().min(1).optional(),
      into: z.enum(["work", "home"]).optional(),
    })
    .optional(),
  connectionIds: z.array(z.string()).optional(),
  providerConnectionId: z.string().min(1).optional(),
  // UNIT_BOUNDARY_DESCRIPTION: kept only so a create that still asks for a container Agent is refused with a reason. Every Agent is a machine; the field is not written to the spec.
  vm: z.boolean().optional(),
  storage: storageQuantitySchema.optional(),
  sweepable: z.boolean().optional(),
  lifetimeMs: z.number().int().min(0).optional(),
});
export const agentPatchSchema = z.object({
  id: z.string().min(1),
  name: agentNameSchema.max(255).optional(),
  description: z.string().optional(),
  avatar: avatarSchema.nullable().optional(),
  env: z.array(envVarSchema).max(64).optional(),
  secretRef: z.string().optional(),
  hibernationTimeoutMin: z.number().int().min(0).nullable().optional(),
  requireConnectionAddress: z.boolean().optional(),
  whisper: z.boolean().optional(),
});

export const agentUpdateInputSchema = agentPatchSchema.pick({
  id: true,
  name: true,
  description: true,
  avatar: true,
  hibernationTimeoutMin: true,
});

export const agentSetEnvInputSchema = z.object({
  id: z.string().min(1),
  env: z.array(envVarSchema).max(64),
});

export const agentSetSecretRefInputSchema = z.object({
  id: z.string().min(1),
  secretRef: z.string(),
});

export const agentSetCredentialInjectionInputSchema = z.object({
  id: z.string().min(1),
  requireConnectionAddress: z.boolean(),
});

export const agentSetWhisperInputSchema = z.object({
  id: z.string().min(1),
  whisper: z.boolean(),
});

export const agentConnectSlackInputSchema = z.object({
  id: z.string().min(1),
  slackChannelId: z.string().min(1),
  ambient: z.boolean().optional(),
  customEmoji: z
    .array(
      z
        .string()
        .regex(
          /^[a-z0-9_'+-]{1,100}$/,
          "Use lowercase letters, digits, - _ + or ' (no colons).",
        ),
    )
    .length(8)
    .nullable()
    .optional(),
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

export const agentPeekBindFlowInputSchema = z.object({
  flowId: z.string().min(1),
});

export const agentBindSlackChannelInputSchema = z.object({
  agentId: z.string().min(1),
  flowId: z.string().min(1),
});
