import { parseGithubRepo } from "agent-runtime-api";

export interface GitHostIdentity {
  kind: "github";
  owner: string;
  repo: string;
}

export function detectHost(gitUrl: string): GitHostIdentity | null {
  const repo = parseGithubRepo(gitUrl);
  return repo ? { kind: "github", ...repo } : null;
}

export function redactToken(message: string): string {
  return message.replace(/https:\/\/[^@\s]+:[^@\s]+@/g, "https://[redacted]@");
}
