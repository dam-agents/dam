import type { Contribution } from "api-server-api";
import type { GitHubIdentity } from "../infrastructure/github-identity.js";

export const GITCONFIG_PATH = "$HOME/.gitconfig";

export function buildGitconfigContribution(
  identity: GitHubIdentity,
): Contribution {
  return {
    kind: "file",
    path: GITCONFIG_PATH,
    format: "ini",
    mergeMode: "section-marker",
    content: { user: { name: identity.name, email: identity.email } },
  };
}

export function upsertGitconfigContribution(
  existing: Contribution[],
  identity: GitHubIdentity,
): Contribution[] {
  const withoutPrior = existing.filter(
    (c) => !(c.kind === "file" && c.path === GITCONFIG_PATH),
  );
  return [...withoutPrior, buildGitconfigContribution(identity)];
}
