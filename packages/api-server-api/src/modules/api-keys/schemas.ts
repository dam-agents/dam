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

export const SATELLITE_SCOPES = ["satellites:serve"] as const;

export const ALL_SCOPES = [
  ...AGENT_SCOPES,
  ...CREDENTIAL_SCOPES,
  ...SATELLITE_SCOPES,
] as const;

/**
 * UNIT_BOUNDARY_DESCRIPTION: what an assistant's own token acts with — its
 * owner's permissions over that owner's Agents and the read half of their
 * credentials, never `credentials:manage`: an assistant drives the install for
 * its owner, and rotating or adding a credential stays the person's.
 */
export const AGENT_ON_BEHALF_SCOPES = [
  ...AGENT_SCOPES,
  "credentials:read",
] as const;

export const scopeSchema = z.enum(ALL_SCOPES);

const agentBindingSchema = z.union([
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
