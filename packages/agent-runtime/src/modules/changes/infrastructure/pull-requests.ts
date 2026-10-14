import { parseGithubRepo, type PullRequestLink } from "agent-runtime-api";

import { INERT_GITHUB_TOKEN } from "../../skills/infrastructure/github-token.js";

const GITHUB_API = "https://api.github.com";
export const PULL_REQUEST_TTL_MS = 60_000;

export interface PullRequestFinder {
  find(
    remoteUrl: string | null,
    branch: string | null,
  ): Promise<PullRequestLink | null>;
}

function asHttps(remoteUrl: string): string {
  const scp = /^[^@/\s]+@([^:/\s]+):(.+)$/.exec(remoteUrl.trim());
  if (scp) return `https://${scp[1]}/${scp[2]}`;
  return remoteUrl.trim().replace(/^ssh:\/\/(?:[^@/]+@)?/, "https://");
}

interface Cached {
  at: number;
  link: Promise<PullRequestLink | null>;
}

export function createPullRequestFinder(deps: {
  token: () => string;
  fetch?: typeof fetch;
  now?: () => number;
  log: (msg: string) => void;
}): PullRequestFinder {
  const fetchImpl = deps.fetch ?? fetch;
  const now = deps.now ?? Date.now;
  const cache = new Map<string, Cached>();

  async function lookUp(
    owner: string,
    repo: string,
    branch: string,
  ): Promise<PullRequestLink | null> {
    const query = new URLSearchParams({
      head: `${owner}:${branch}`,
      state: "open",
      per_page: "1",
    });
    try {
      const response = await fetchImpl(
        `${GITHUB_API}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls?${query}`,
        {
          headers: {
            Accept: "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
            Authorization: `Bearer ${deps.token()}`,
          },
        },
      );
      if (!response.ok) {
        deps.log(
          `pull request lookup for ${owner}/${repo}@${branch} answered ${response.status}`,
        );
        return null;
      }
      const pulls = (await response.json()) as unknown;
      const first = Array.isArray(pulls)
        ? (pulls[0] as { number?: unknown; html_url?: unknown } | undefined)
        : undefined;
      return typeof first?.number === "number" &&
        typeof first.html_url === "string"
        ? { number: first.number, url: first.html_url }
        : null;
    } catch (error) {
      deps.log(
        `pull request lookup for ${owner}/${repo}@${branch} failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      return null;
    }
  }

  return {
    find(remoteUrl, branch) {
      if (!remoteUrl || !branch) return Promise.resolve(null);
      if (deps.token() === INERT_GITHUB_TOKEN) return Promise.resolve(null);
      const github = parseGithubRepo(asHttps(remoteUrl));
      if (!github) return Promise.resolve(null);
      const key = `${github.owner}/${github.repo}#${branch}`;
      const cached = cache.get(key);
      if (cached && now() - cached.at < PULL_REQUEST_TTL_MS) return cached.link;
      const link = lookUp(github.owner, github.repo, branch);
      cache.set(key, { at: now(), link });
      return link;
    },
  };
}
