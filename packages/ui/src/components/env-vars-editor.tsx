import type { EnvVar } from "../types.js";

export function sanitizeEnvVars(list: EnvVar[]): EnvVar[] {
  return list
    .map((v) => ({ name: v.name.trim(), value: v.value.trim() }))
    .filter((v) => v.name !== "");
}
