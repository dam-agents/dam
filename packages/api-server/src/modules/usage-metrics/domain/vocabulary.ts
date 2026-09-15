export type UsageSurface = "ui" | "cli" | "other" | "slack" | "telegram";

export type UsageOutcome = "success" | "failure";

export type RelayKind = "acp" | "terminal" | "ssh" | "trpc" | "other";

export type ConnectionChangeAction = "added" | "removed";

const OTHER = "other";

const SURFACES = new Map<string, UsageSurface>([
  ["ui", "ui"],
  ["cli", "cli"],
  ["other", "other"],
  ["slack", "slack"],
  ["telegram", "telegram"],
]);

const RELAY_KINDS = new Map<string, RelayKind>([
  ["acp", "acp"],
  ["terminal", "terminal"],
  ["ssh", "ssh"],
  ["trpc", "trpc"],
  ["other", "other"],
]);

export function toUsageSurface(raw: string): UsageSurface {
  return SURFACES.get(raw) ?? OTHER;
}

export function toRelayKind(raw: string): RelayKind {
  return RELAY_KINDS.get(raw) ?? OTHER;
}

export function createBoundedValues(limit: number): (raw: string) => string {
  const admitted = new Set<string>();
  return (raw) => {
    if (raw === "") return OTHER;
    if (admitted.has(raw)) return raw;
    if (admitted.size >= limit) return OTHER;
    admitted.add(raw);
    return raw;
  };
}
