import { normalizeGitUrl } from "agent-runtime-api";

export function deriveSourceName(gitUrl: string): string {
  const normalized = normalizeGitUrl(gitUrl);
  if (!normalized) return "";
  return new URL(normalized.gitUrl).pathname.replace(/^\//, "");
}
