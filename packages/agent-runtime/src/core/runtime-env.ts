import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

// Placeholder env on the PV: written by the env driver, read by spawn paths.
const RUNTIME_ENV_NOTE =
  "Managed by the platform runtime. Do not edit — overwritten on the next sync.";

export function runtimeEnvPath(agentHome: string): string {
  return join(agentHome, ".platform", "runtime-env.json");
}

// Atomic overwrite (temp + rename) so a concurrent spawn never reads a torn file.
export function writeRuntimeEnv(
  agentHome: string,
  env: Record<string, string>,
): void {
  const path = runtimeEnvPath(agentHome);
  mkdirSync(dirname(path), { recursive: true });
  const body = JSON.stringify({ _note: RUNTIME_ENV_NOTE, env }, null, 2);
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, body, "utf8");
  renameSync(tmp, path);
}

// A missing or unparseable file yields {} (the next snapshot heals it).
export function readRuntimeEnv(agentHome: string): Record<string, string> {
  let raw: string;
  try {
    raw = readFileSync(runtimeEnvPath(agentHome), "utf8");
  } catch {
    return {};
  }
  try {
    const parsed = JSON.parse(raw) as { env?: Record<string, string> };
    return parsed.env ?? {};
  } catch {
    return {};
  }
}
