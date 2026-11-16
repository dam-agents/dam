import type { Connection } from "api-server-api";

export function connectionEnv(connection: Connection): Record<string, string> {
  const env: Record<string, string> = {};
  for (const contribution of connection.contributions) {
    if (contribution.kind === "env")
      env[contribution.name] = contribution.placeholder;
  }
  return env;
}
