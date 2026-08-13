import type { SkillSource } from "api-server-api";

export function resolveSourceRef(
  sources: readonly SkillSource[],
  ref: string,
): SkillSource | null {
  if (ref.includes("://")) {
    return sources.find((s) => s.gitUrl === ref) ?? null;
  }
  return sources.find((s) => s.id === ref) ?? null;
}

export function sourceKind(s: SkillSource): "Platform" | "Agent" | "User" {
  if (s.system) return "Platform";
  if (s.fromTemplate) return "Agent";
  return "User";
}
