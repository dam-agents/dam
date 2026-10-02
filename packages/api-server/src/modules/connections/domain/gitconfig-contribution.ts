import { GITCONFIG_FILE_PATH, type Contribution } from "api-server-api";
import type { GitHubIdentity } from "../infrastructure/github-identity.js";

export function upsertGitconfigContribution(
  existing: Contribution[],
  identity: GitHubIdentity,
): Contribution[] {
  const withoutPrior = existing.filter(
    (c) => !(c.kind === "file" && c.path === GITCONFIG_FILE_PATH),
  );
  return [
    ...withoutPrior,
    {
      kind: "file",
      path: GITCONFIG_FILE_PATH,
      format: "ini",
      mergeMode: "section-marker",
      content: { user: { name: identity.name, email: identity.email } },
    },
  ];
}
