import { DAM_TOKEN_ENV_VAR } from "../auth/infrastructure/auth-env-reader.js";

export function formatAuthRejection(
  reason: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const hint = env[DAM_TOKEN_ENV_VAR]
    ? "DAM_TOKEN was rejected — check it is valid and unexpired"
    : "run `dam auth login` first";
  return `error: not authenticated: ${reason}\nhint: ${hint}\n`;
}
