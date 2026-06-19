import { DAM_TOKEN_ENV_VAR } from "../auth/infrastructure/auth-env-reader.js";

/**
 * The standard two-line block the CLI prints when the server (or the local
 * token provider) rejects a request for lack of valid authentication. The
 * hint depends on how the bearer was supplied: a `DAM_TOKEN` is passed
 * verbatim and never lives in `auth.toml`, so `dam auth login` can't fix it —
 * the token itself was rejected, so point at the env var instead.
 *
 * Single source of truth so every entry point — the tRPC path
 * (`printServiceError`) and the raw-fetch paths (`dam import`) — agrees on the
 * wording and the remedy.
 */
export function formatAuthRejection(
  reason: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const hint = env[DAM_TOKEN_ENV_VAR]
    ? "DAM_TOKEN was rejected — check it is valid and unexpired"
    : "run `dam auth login` first";
  return `error: not authenticated: ${reason}\nhint: ${hint}\n`;
}
