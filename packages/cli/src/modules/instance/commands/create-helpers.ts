import type { EnvVar } from "api-server-api";
import { err, ok, type Result } from "../../../result.js";

const ENV_NAME_RE = /^[A-Z_][A-Z0-9_]*$/;
const RESERVED_INSTANCE_PREFIX = "inst-";

export type EnvParseError =
  | { kind: "missing-equals"; input: string }
  | { kind: "invalid-name"; key: string };

export interface ParsedEnv {
  vars: EnvVar[];
  /** Keys that appeared more than once. Last-wins semantics are
   *  preserved; this list lets the command layer warn the user so a
   *  misconfigured `--env FOO=1 --env FOO=2` is at least visible. */
  duplicates: readonly string[];
}

/**
 * Parses commander's repeatable `--env KEY=VAL` array into the wire shape
 * `agents.create` accepts. Rules (locked in spec §4.2):
 *
 * - Split on the **first** `=`; subsequent `=` chars are kept in the value.
 * - Missing `=` → `missing-equals` (exit 2).
 * - Empty value (`KEY=`) is valid.
 * - Key must match `[A-Z_][A-Z0-9_]*` (same regex the server enforces
 *   via `ENV_NAME_RE` in `secrets/types.ts`).
 * - On duplicate keys, **last wins**; the duplicate keys are returned
 *   alongside so the command layer can surface them.
 */
export function parseEnvFlag(values: readonly string[]): Result<ParsedEnv, EnvParseError> {
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

export function validateInstanceName(name: string): Result<void, NameValidationError> {
  if (name.length === 0) return err("empty");
  if (name.startsWith(RESERVED_INSTANCE_PREFIX)) return err("reserved-prefix");
  return ok(undefined);
}
