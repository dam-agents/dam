import { createHash } from "node:crypto";
import type { Contribution } from "api-server-api";

export function contributionHash(contributions: Contribution[]): string {
  const sorted = [...contributions]
    .map(canonicalize)
    .sort((a, b) => cmp(a.k, b.k) || cmp(a.json, b.json));
  const json = JSON.stringify(sorted.map((s) => s.value));
  return createHash("sha256").update(json).digest("hex");
}

function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function canonicalize(c: Contribution): {
  k: string;
  json: string;
  value: unknown;
} {
  const value = sortKeys(c);
  return { k: keyFor(c), json: JSON.stringify(value), value };
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
