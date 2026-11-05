/**
 * UNIT_BOUNDARY_DESCRIPTION: how a `dam` inside an assistant's own machine finds
 * its identity. There is no secret at rest: the environment names the exchange
 * the platform opened for it — the agent's own harness route — and the CLI asks
 * it for a short-lived token whenever it needs one, so nothing durable is left
 * on disk for a chat to read.
 */
export const DAM_TOKEN_ENV_VAR = "DAM_TOKEN";
export const DAM_AGENT_TOKEN_URL_ENV_VAR = "DAM_AGENT_TOKEN_URL";

export interface AuthEnvReader {
  damToken(): string | undefined;
  /* UNIT_BOUNDARY_DESCRIPTION: the exchange to mint an assistant's own bearer from, when this process runs inside one of the install's assistants. */
  agentTokenUrl(): string | undefined;
}

export function createProcessAuthEnvReader(
  env: NodeJS.ProcessEnv = process.env,
): AuthEnvReader {
  return {
    damToken() {
      const v = env[DAM_TOKEN_ENV_VAR];
      return v && v.length > 0 ? v : undefined;
    },
    agentTokenUrl() {
      const v = env[DAM_AGENT_TOKEN_URL_ENV_VAR];
      return v && v.length > 0 ? v : undefined;
    },
  };
}
