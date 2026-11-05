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
