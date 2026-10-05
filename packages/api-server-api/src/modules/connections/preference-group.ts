import type { Contribution } from "agent-runtime-api";
import { signingTargetOf } from "./aws-profiles.js";
import { githubHostOf } from "./github-host.js";

export const AWS_PROFILE_PREFERENCE_GROUP = "aws-profile";

export function preferenceGroupOf(
  contributions: readonly Contribution[],
): string | undefined {
  const github = githubHostOf(contributions);
  if (github !== undefined) return `github:${github}`;
  return signingTargetOf(contributions) === undefined
    ? undefined
    : AWS_PROFILE_PREFERENCE_GROUP;
}
