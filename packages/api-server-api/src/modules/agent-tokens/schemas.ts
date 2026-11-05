import { z } from "zod";

/**
 * UNIT_BOUNDARY_DESCRIPTION: the token a running assistant exchanges its own
 * identity for — the harness route answers it, and the CLI sends it as the
 * bearer of every deployment call. Its own kind, so the api-server can tell it
 * from a Keycloak JWT and an API key by prefix alone.
 */
export const AGENT_TOKEN_PREFIX = "ob_";

export const agentTokenResponseSchema = z.object({
  token: z.string().min(1),
  expiresAt: z.string().datetime(),
});

export type AgentTokenResponse = z.infer<typeof agentTokenResponseSchema>;
