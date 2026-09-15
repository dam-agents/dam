import { normalizeGitUrl } from "agent-runtime-api";
import type { SkillSource } from "api-server-api";

export function resolveSourceRef(
  sources: readonly SkillSource[],
  ref: string,
): SkillSource | null {
  const byId = sources.find((s) => s.id === ref);
  if (byId) return byId;
  const normalized = normalizeGitUrl(ref);
  if (!normalized) return null;
  return (
    sources.find(
      (s) => normalizeGitUrl(s.gitUrl)?.gitUrl === normalized.gitUrl,
    ) ?? null
  );
}

export function sourceKind(s: SkillSource): "Platform" | "Agent" | "User" {
  if (s.system) return "Platform";
  if (s.fromTemplate) return "Agent";
  return "User";
}
