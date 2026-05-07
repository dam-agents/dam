import type { EnvMapping } from "../../../types.js";

/**
 * Conservative cap on the JSON-encoded `env-mappings` annotation. K8s caps
 * total annotations at 256 KiB per object; reserving a chunk leaves headroom
 * for `host-pattern`, `injection-*`, `display-name`, `secrets-rev`, etc.
 * Surfaces here as a UX guard so the api-server's K8s write succeeds and the
 * runtime doesn't go silently quiet via the controller's parse-tolerant
 * fallback (ADR-040).
 */
export const ENV_MAPPINGS_MAX_BYTES = 32 * 1024;

export type EnvMappingsSizeResult =
  | { ok: true }
  | { ok: false; bytes: number; limit: number };

export function validateEnvMappingsSize(mappings: EnvMapping[]): EnvMappingsSizeResult {
  // Mirrors what the api-server writes: `JSON.stringify(envMappings)`. The
  // serialized length is what counts against the K8s annotation budget.
  const bytes = new TextEncoder().encode(JSON.stringify(mappings)).length;
  if (bytes <= ENV_MAPPINGS_MAX_BYTES) return { ok: true };
  return { ok: false, bytes, limit: ENV_MAPPINGS_MAX_BYTES };
}
