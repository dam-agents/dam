import type { Contribution } from "api-server-api";
import type { GitHubIdentity } from "../infrastructure/github-identity.js";

export const GITCONFIG_PATH = "$HOME/.gitconfig";

/**
 * A `~/.gitconfig` `[user]` section authoring the agent's commits as the
 * connected account. `section-marker` is the only remove-safe mode that works
 * for `ini` — the file driver's `ini` parser returns a raw string, so a
 * `key-targeted` merge would corrupt the file.
 */
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

/**
 * Replaces any prior platform gitconfig contribution with a fresh one so
 * re-auth doesn't accumulate duplicates in the stored array.
 */
export function upsertGitconfigContribution(
  existing: Contribution[],
  identity: GitHubIdentity,
): Contribution[] {
  const withoutPrior = existing.filter(
    (c) => !(c.kind === "file" && c.path === GITCONFIG_PATH),
  );
  return [...withoutPrior, buildGitconfigContribution(identity)];
}
