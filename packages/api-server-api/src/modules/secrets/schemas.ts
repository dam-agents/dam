import { z } from "zod";
import { ENV_NAME_RE } from "../shared.js";

export const presetSecretTypeSchema = z.enum([
  "anthropic",
  "ibm-litellm",
  "openai",
  "bob",
]);

/**
 * Reusable hostPattern field. Rejects wildcard patterns (`*`) because the
 * agent network gateway (Envoy) cannot route them and the pod would crash-loop.
 */
export const hostPatternSchema = z
  .string()
  .min(1)
  .max(253)
  .refine((v) => !v.includes("*"), {
    message:
      "Wildcard host patterns are not supported. Please specify exact hostnames.",
  });

export const envMappingSchema = z.object({
  envName: z
    .string()
    .min(1)
    .max(255)
    .regex(ENV_NAME_RE, "envName must match [A-Z_][A-Z0-9_]*"),
  placeholder: z.string().min(1).max(1000),
});

export const envMappingsSchema = z.array(envMappingSchema).max(32);

export const secretCreateInputSchema = z.object({
  type: presetSecretTypeSchema,
  name: z.string().min(1).max(100),
  value: z.string().min(1),
  envMappings: envMappingsSchema.optional(),
});

export const secretUpdateInputSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(100).optional(),
  value: z.string().min(1).optional(),
  envMappings: envMappingsSchema.optional(),
});

export const secretDeleteInputSchema = z.object({ id: z.string().min(1) });

export const secretCreateGithubPatInputSchema = z.object({
  name: z.string().min(1).max(100),
  token: z.string().min(1),
});

export const secretUpdateGithubPatInputSchema = z.object({
  apiSecretId: z.string().min(1),
  gitSecretId: z.string().min(1),
  token: z.string().min(1),
});

export const secretGetAgentAccessInputSchema = z.object({
  agentId: z.string().min(1),
});

export const secretSetAgentAccessInputSchema = z.object({
  agentId: z.string().min(1),
  secretIds: z.array(z.string().min(1)),
});

export const secretTestAnthropicInputSchema = z.object({
  value: z.string().min(1),
  envName: z.enum(["ANTHROPIC_API_KEY", "CLAUDE_CODE_OAUTH_TOKEN"]),
});
