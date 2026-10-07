import { createHash } from "node:crypto";
import type { DriverBinding } from "agent-runtime-api";

export function bindingsFingerprint(
  bindings: Record<string, DriverBinding>,
): string {
  return createHash("sha256")
    .update(JSON.stringify(sortKeys(bindings)))
    .digest("hex");
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(obj).sort()) out[k] = sortKeys(obj[k]);
    return out;
  }
  return value;
}
