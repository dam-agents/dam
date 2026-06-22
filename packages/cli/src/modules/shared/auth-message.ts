import { DAM_TOKEN_ENV_VAR } from "../auth/infrastructure/auth-env-reader.js";

// A DAM_TOKEN is sent verbatim and never stored in auth.toml, so `dam auth
// login` can't fix a rejected one — point at the env var instead.
export function formatAuthRejection(
  reason: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const hint = env[DAM_TOKEN_ENV_VAR]
    ? "DAM_TOKEN was rejected — check it is valid and unexpired"
    : "run `dam auth login` first";
  return `error: not authenticated: ${reason}\nhint: ${hint}\n`;
}
