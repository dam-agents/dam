/**
 * Pure parsers for git host URLs. The actual GitHub REST calls live in
 * agent-runtime (which is wired through OneCLI's MITM); api-server just
 * needs to know which host a source points at.
 */

export interface GitHostIdentity {
  kind: "github";
  owner: string;
  repo: string;
}

/** Parse a git URL into a host-kind + owner/repo pair, or null if unsupported. */
export function detectHost(gitUrl: string): GitHostIdentity | null {
  // Trailing slash → .git → trailing slash again, to tolerate all four shapes.
  const trimmed = gitUrl.replace(/\/+$/, "").replace(/\.git$/, "").replace(/\/+$/, "");
  const m = /^https:\/\/github\.com\/([^/]+)\/([^/]+)$/.exec(trimmed);
  if (m) return { kind: "github", owner: m[1], repo: m[2] };
  return null;
}

/** Strip any token embedded in a URL before surfacing an error. Legacy —
 *  retained because callers still pass git-error strings through this. */
export function redactToken(message: string): string {
  return message.replace(/https:\/\/[^@\s]+:[^@\s]+@/g, "https://[redacted]@");
}
