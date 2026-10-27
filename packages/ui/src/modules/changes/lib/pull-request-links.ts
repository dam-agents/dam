import type { SessionRepository } from "agent-runtime-api";

export interface PullRequestLink {
  label: string;
  title: string;
  url: string;
}

export function repositoryShortName(name: string): string {
  return name.split("/").pop() ?? name;
}

function lastSegment(path: string): string {
  return path.split("/").filter(Boolean).pop() ?? path;
}

// UNIT_BOUNDARY_DESCRIPTION: the repositories a Session's row shows as badges: those it has a pull request in, one badge per pull request. A Session links every repository it commits or pushes in, and the tools it runs commit in caches and plugins too, so a repository without a pull request says nothing about the Session's work; the Changes Panel still opens on the one it committed in last. Two clones on one branch link the same pull request, and its badge keeps the clone edited last, which comes first.
export function badgeRepositories(
  repositories: readonly SessionRepository[] | undefined,
): SessionRepository[] {
  const byPullRequest = new Map<string, SessionRepository>();
  for (const repository of repositories ?? []) {
    const url = repository.pullRequest?.url;
    if (url && !byPullRequest.has(url)) byPullRequest.set(url, repository);
  }
  return [...byPullRequest.values()];
}

export function repositoryBadgeLabels(
  repositories: readonly SessionRepository[],
): string[] {
  const count = (labels: string[], label: string) =>
    labels.filter((other) => other === label).length;
  const names = repositories.map(({ name }) => repositoryShortName(name));
  const withBranch = repositories.map(({ branch, path }, index) =>
    count(names, names[index]!) > 1
      ? `${names[index]} · ${branch ?? lastSegment(path)}`
      : names[index]!,
  );
  return repositories.map(({ path }, index) =>
    count(withBranch, withBranch[index]!) > 1
      ? `${names[index]} · ${lastSegment(path)}`
      : withBranch[index]!,
  );
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
