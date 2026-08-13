import { ENV_NAME_RE, type EnvVar } from "api-server-api";
import { err, ok, type Result } from "../../../result.js";

const RESERVED_AGENT_PREFIX = "agent-";

export type EnvParseError =
  | { kind: "missing-equals"; input: string }
  | { kind: "invalid-name"; key: string };

export interface ParsedEnv {
  vars: EnvVar[];
  duplicates: readonly string[];
}

export function parseEnvFlag(
  values: readonly string[],
): Result<ParsedEnv, EnvParseError> {
  const map = new Map<string, string>();
  const duplicates = new Set<string>();
  for (const raw of values) {
    const eq = raw.indexOf("=");
    if (eq < 0) return err({ kind: "missing-equals", input: raw });
    const key = raw.slice(0, eq);
    const value = raw.slice(eq + 1);
    if (!ENV_NAME_RE.test(key)) return err({ kind: "invalid-name", key });
    if (map.has(key)) duplicates.add(key);
    map.set(key, value);
  }
  return ok({
    vars: [...map.entries()].map(([name, value]) => ({ name, value })),
    duplicates: [...duplicates],
  });
}

export type NameValidationError = "empty" | "reserved-prefix";

export function validateAgentName(
  name: string,
): Result<void, NameValidationError> {
  if (name.length === 0) return err("empty");
  if (name.startsWith(RESERVED_AGENT_PREFIX)) return err("reserved-prefix");
  return ok(undefined);
}
