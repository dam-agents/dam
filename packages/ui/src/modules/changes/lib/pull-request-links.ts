import type { SessionRepository } from "agent-runtime-api";

export interface PullRequestLink {
  label: string;
  title: string;
  url: string;
}

export function repositoryShortName(name: string): string {
  return name.split("/").pop() ?? name;
}

export function pullRequestLinks(
  repositories: readonly SessionRepository[] | undefined,
): PullRequestLink[] {
  const links = new Map<string, PullRequestLink>();
  for (const { name, branch, pullRequest } of repositories ?? []) {
    if (!pullRequest || links.has(pullRequest.url)) continue;
    links.set(pullRequest.url, {
      label: `${repositoryShortName(name)} #${pullRequest.number}`,
      title: `${name}#${pullRequest.number}${branch ? ` · ${branch}` : ""}`,
      url: pullRequest.url,
    });
  }
  return [...links.values()];
}
