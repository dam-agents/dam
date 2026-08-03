import { createHash } from "node:crypto";
import type { Contribution } from "api-server-api";

export function contributionHash(contributions: Contribution[]): string {
  const sorted = [...contributions]
    .map(canonicalize)
    .sort((a, b) => (a.k < b.k ? -1 : a.k > b.k ? 1 : 0));
  const json = JSON.stringify(sorted.map((s) => s.value));
  return createHash("sha256").update(json).digest("hex");
}

function canonicalize(c: Contribution): { k: string; value: unknown } {
  return { k: keyFor(c), value: sortKeys(c) };
}

function keyFor(c: Contribution): string {
  switch (c.kind) {
    case "env":
      return `env:${c.name}`;
    case "egress-allow":
      return `egress-allow:${c.host}:${c.port ?? ""}:${c.pathPattern ?? ""}`;
    case "egress-inject":
      return `egress-inject:${c.host}:${c.port ?? ""}:${c.pathPattern ?? ""}`;
    case "file":
      return `file:${c.path}`;
    case "mcp-entry":
      return `mcp-entry:${c.name}`;
    case "skill-ref":
      return `skill-ref:${c.name}@${c.version}@${c.sourceUrl}@${c.path ?? ""}`;
  }
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(obj).sort()) {
      out[k] = sortKeys(obj[k]);
    }
    return out;
  }
  return value;
}
