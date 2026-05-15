/**
 * Narrow env-reader port — reads only `DAM_TOKEN`. Kept distinct from
 * `modules/cli/infrastructure/env-reader.ts` (which reads CLI config env
 * vars like `DAM_SERVER`) so each module owns the env contract it
 * actually depends on. Empty string is treated as unset, matching the
 * XDG and EnvReader conventions.
 */

export const DAM_TOKEN_ENV_VAR = "DAM_TOKEN";

export interface AuthEnvReader {
  damToken(): string | undefined;
}

export function createProcessAuthEnvReader(
  env: NodeJS.ProcessEnv = process.env,
): AuthEnvReader {
  return {
    damToken() {
      const v = env[DAM_TOKEN_ENV_VAR];
      return v && v.length > 0 ? v : undefined;
    },
  };
}
