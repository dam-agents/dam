import { z } from "zod";

export const AGENT_SCOPES = [
  "agents:read",
  "agents:operate",
  "agents:manage",
] as const;

export const CREDENTIAL_SCOPES = [
  "credentials:read",
  "credentials:manage",
] as const;

export const ALL_SCOPES = [...AGENT_SCOPES, ...CREDENTIAL_SCOPES] as const;

export const scopeSchema = z.enum(ALL_SCOPES);

export const agentBindingSchema = z.union([
  z.literal("*"),
  z
    .array(z.string().min(1))
    .min(1)
    .max(256)
    .transform((arr) => Array.from(new Set(arr))),
]);

export const apiKeyCreateInputSchema = z.object({
  name: z.string().min(1).max(100),
  scopes: z
    .array(scopeSchema)
    .min(1)
    .transform((arr) => Array.from(new Set(arr))),
  agentIds: agentBindingSchema.default("*"),
  expiresAt: z.string().datetime().nullable().optional(),
});

export const apiKeyRevokeInputSchema = z.object({
  id: z.string().min(1),
});
