import type { Contribution } from "agent-runtime-api";
import { isSigv4Connection } from "./aws-profiles.js";
import { githubHostOf } from "./github-host.js";

export function preferenceGroupOf(
  contributions: readonly Contribution[],
): string | undefined {
  const host = githubHostOf(contributions);
  if (host !== undefined) return `github:${host}`;
  return isSigv4Connection(contributions) ? "aws-s3" : undefined;
}
