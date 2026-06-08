import type { SkillSource } from "api-server-api";

/**
 * Resolve `--source <id|url>` to a registered source. A value containing `://`
 * is a git URL (matched by gitUrl); anything else is a source id. Names are
 * never resolved — source names may contain spaces. Returns null when nothing
 * matches. Mirrors `resolveConnectionRef`.
 */
export function resolveSourceRef(
  sources: readonly SkillSource[],
  ref: string,
): SkillSource | null {
  if (ref.includes("://")) {
    return sources.find((s) => s.gitUrl === ref) ?? null;
  }
  return sources.find((s) => s.id === ref) ?? null;
}
