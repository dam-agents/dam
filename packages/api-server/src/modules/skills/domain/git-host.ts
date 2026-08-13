export interface GitHostIdentity {
  kind: "github";
  owner: string;
  repo: string;
}

export function detectHost(gitUrl: string): GitHostIdentity | null {
  const trimmed = gitUrl
    .replace(/\/+$/, "")
    .replace(/\.git$/, "")
    .replace(/\/+$/, "");
  const m = /^https:\/\/github\.com\/([^/]+)\/([^/]+)$/.exec(trimmed);
  if (m) return { kind: "github", owner: m[1], repo: m[2] };
  return null;
}

export function redactToken(message: string): string {
  return message.replace(/https:\/\/[^@\s]+:[^@\s]+@/g, "https://[redacted]@");
}
