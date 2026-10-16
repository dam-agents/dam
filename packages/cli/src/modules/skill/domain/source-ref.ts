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
  const sameRepo = sources.filter(
    (s) => normalizeGitUrl(s.gitUrl)?.gitUrl === normalized.gitUrl,
  );
  const wanted = canonicalPath(normalized.path);
  if (wanted !== undefined) {
    return sameRepo.find((s) => canonicalPath(s.path) === wanted) ?? null;
  }
  const pathless = sameRepo.find((s) => canonicalPath(s.path) === undefined);
  if (pathless) return pathless;
  return sameRepo.length === 1 ? sameRepo[0] : null;
}

function canonicalPath(path: string | undefined): string | undefined {
  const dir = path?.split("/").filter(Boolean).join("/");
  return dir || undefined;
}

export function sourceKind(s: SkillSource): "Platform" | "Agent" | "User" {
  if (s.system) return "Platform";
  if (s.fromTemplate) return "Agent";
  return "User";
}
