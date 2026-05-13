import type { EnvVar } from "api-server-api";
import { err, ok, type Result } from "../../../result.js";

const ENV_NAME_RE = /^[A-Z_][A-Z0-9_]*$/;
const RESERVED_INSTANCE_PREFIX = "inst-";

export type EnvParseError =
  | { kind: "missing-equals"; input: string }
  | { kind: "invalid-name"; key: string };

/**
 * Parses commander's repeatable `--env KEY=VAL` array into the wire shape
 * `agents.create` accepts. Rules (locked in spec §4.2):
 *
 * - Split on the **first** `=`; subsequent `=` chars are kept in the value.
 * - Missing `=` → `missing-equals` (exit 2).
 * - Empty value (`KEY=`) is valid.
 * - Key must match `[A-Z_][A-Z0-9_]*` (same regex the server enforces
 *   via `ENV_NAME_RE` in `secrets/types.ts`).
 * - On duplicate keys, **last wins** silently (UX §1.6).
 */
export function parseEnvFlag(values: readonly string[]): Result<EnvVar[], EnvParseError> {
  const map = new Map<string, string>();
  for (const raw of values) {
    const eq = raw.indexOf("=");
    if (eq < 0) return err({ kind: "missing-equals", input: raw });
    const key = raw.slice(0, eq);
    const value = raw.slice(eq + 1);
    if (!ENV_NAME_RE.test(key)) return err({ kind: "invalid-name", key });
    map.set(key, value);
  }
  return ok([...map.entries()].map(([name, value]) => ({ name, value })));
}

export type NameValidationError = "empty" | "reserved-prefix";

export function validateInstanceName(name: string): Result<void, NameValidationError> {
  if (name.length === 0) return err("empty");
  if (name.startsWith(RESERVED_INSTANCE_PREFIX)) return err("reserved-prefix");
  return ok(undefined);
}
