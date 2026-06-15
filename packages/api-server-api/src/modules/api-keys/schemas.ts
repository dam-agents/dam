import { z } from "zod";

/**
 * Agent-domain scopes, narrowest first:
 * - `agents:read`    — read-only view of agents and their configuration; no
 *                      mutations, no run.
 * - `agents:operate` — run a live agent (approvals, workspace file upload).
 *                      Running can mutate state through the agent runtime
 *                      (filesystem, schedules via MCP), so this is not a
 *                      read-only scope. Supports wildcard or per-agent binding.
 * - `agents:manage`  — full agent configuration + lifecycle (CRUD, channels,
 *                      schedules, skills, egress rules, credential assignment).
 *                      Wildcard-bound by design; per-agent downscoping is a
 *                      future refinement.
 */
export const AGENT_SCOPES = [
  "agents:read",
  "agents:operate",
  "agents:manage",
] as const;

/**
 * Credential-domain scopes covering both OAuth connections and user-supplied
 * secrets. `credentials:manage` implies `credentials:read`.
 */
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
