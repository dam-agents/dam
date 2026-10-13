import { type EnvVar, isValidEnvName } from "../types.js";

export function sanitizeEnvVars(list: EnvVar[]): EnvVar[] {
  return list
    .map((v) => ({ name: v.name.trim(), value: v.value.trim() }))
    .filter((v) => v.name !== "");
}

export function allEnvVarsValid(list: EnvVar[]): boolean {
  return sanitizeEnvVars(list).every((v) => isValidEnvName(v.name));
}
