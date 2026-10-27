import {
  parseGithubRepo,
  type PullRequestLink,
  type PullRequestState,
} from "agent-runtime-api";

import { INERT_GITHUB_TOKEN } from "../../skills/infrastructure/github-token.js";

const GITHUB_GRAPHQL = "https://api.github.com/graphql";
export const PULL_REQUEST_TTL_MS = 60_000;

export interface PullRequestFinder {
  find(
    remoteUrl: string | null,
    branch: string | null,
  ): Promise<PullRequestLink | null>;
  states(links: readonly PullRequestLink[]): Promise<PullRequestLink[]>;
}

const PULL_REQUEST_FIELDS =
  "number url state isDraft reviewDecision mergeable headRepositoryOwner { login } latestOpinionatedReviews(first: 50) { nodes { state } }";

const OPEN_OF_BRANCH = `query($owner: String!, $repo: String!, $branch: String!) {
  repository(owner: $owner, name: $repo) {
    pullRequests(headRefName: $branch, states: OPEN, first: 20, orderBy: { field: CREATED_AT, direction: DESC }) {
      nodes { ${PULL_REQUEST_FIELDS} }
    }
  }
}`;

function byNumbers(count: number): string {
  const indexes = [...Array(count).keys()];
  const variables = indexes
    .map((i) => `$o${i}: String!, $r${i}: String!, $n${i}: Int!`)
    .join(", ");
  const fields = indexes
    .map(
      (i) =>
        `p${i}: repository(owner: $o${i}, name: $r${i}) { pullRequest(number: $n${i}) { ${PULL_REQUEST_FIELDS} } }`,
    )
    .join("\n  ");
  return `query(${variables}) {\n  ${fields}\n}`;
}

interface PullRequestNode {
  number?: unknown;
  url?: unknown;
  state?: unknown;
  isDraft?: unknown;
  reviewDecision?: unknown;
  mergeable?: unknown;
  headRepositoryOwner?: { login?: unknown } | null;
  latestOpinionatedReviews?: { nodes?: { state?: unknown }[] } | null;
}

function asHttps(remoteUrl: string): string {
  const scp = /^[^@/\s]+@([^:/\s]+):(.+)$/.exec(remoteUrl.trim());
  if (scp) return `https://${scp[1]}/${scp[2]}`;
  return remoteUrl.trim().replace(/^ssh:\/\/(?:[^@/]+@)?/, "https://");
}

function reviewOf(node: PullRequestNode): unknown {
  if (node.reviewDecision) return node.reviewDecision;
  const reviews = (node.latestOpinionatedReviews?.nodes ?? []).map(
    ({ state }) => state,
  );
  if (reviews.includes("CHANGES_REQUESTED")) return "CHANGES_REQUESTED";
  if (reviews.includes("APPROVED")) return "APPROVED";
  return null;
}

function stateOf(node: PullRequestNode): PullRequestState {
  if (node.state === "MERGED") return "merged";
  if (node.state === "CLOSED") return "closed";
  if (node.isDraft === true) return "draft";
  const review = reviewOf(node);
  if (review === "APPROVED") return "approved";
  if (review === "CHANGES_REQUESTED") return "changes-requested";
  return "pending";
}

function linkOf(
  node: PullRequestNode | null | undefined,
): PullRequestLink | null {
  if (typeof node?.number !== "number" || typeof node.url !== "string")
    return null;
  return {
    number: node.number,
    url: node.url,
    state: stateOf(node),
    conflicts: node.mergeable === "CONFLICTING",
  };
}

function coordinatesOf(
  url: string,
): { owner: string; repo: string; number: number } | null {
  const m = /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)$/.exec(url);
  return m ? { owner: m[1]!, repo: m[2]!, number: Number(m[3]) } : null;
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

  async function query(
    what: string,
    text: string,
    variables: Record<string, string | number>,
  ): Promise<Record<string, Record<string, unknown> | null> | null> {
    try {
      const response = await fetchImpl(GITHUB_GRAPHQL, {
        method: "POST",
        headers: {
          Accept: "application/vnd.github+json",
          "Content-Type": "application/json",
          Authorization: `Bearer ${deps.token()}`,
        },
        body: JSON.stringify({ query: text, variables }),
      });
      if (!response.ok) {
        deps.log(`pull request lookup for ${what} answered ${response.status}`);
        return null;
      }
      const answer = (await response.json()) as {
        data?: Record<string, Record<string, unknown> | null> | null;
        errors?: unknown[];
      };
      if (answer.errors?.length)
        deps.log(
          `pull request lookup for ${what} answered ${answer.errors.length} error(s)`,
        );
      return answer.data ?? null;
    } catch (error) {
      deps.log(
        `pull request lookup for ${what} failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      return null;
    }
  }

  async function openOfBranch(
    owner: string,
    repo: string,
    branch: string,
  ): Promise<PullRequestLink | null> {
    const data = await query(`${owner}/${repo}@${branch}`, OPEN_OF_BRANCH, {
      owner,
      repo,
      branch,
    });
    const nodes = (
      data?.repository?.pullRequests as
        { nodes?: PullRequestNode[] } | undefined
    )?.nodes;
    const own = (nodes ?? []).find(
      (node) =>
        typeof node.headRepositoryOwner?.login === "string" &&
        node.headRepositoryOwner.login.toLowerCase() === owner.toLowerCase(),
    );
    return linkOf(own);
  }

  const readAt = new Map<string, { at: number; link: PullRequestLink }>();

  function newest(at: number, link: PullRequestLink): PullRequestLink {
    const known = readAt.get(link.url);
    if (known && known.at > at) return known.link;
    readAt.set(link.url, { at, link });
    return link;
  }

  function cached(
    key: string,
    lookUp: () => Promise<PullRequestLink | null>,
  ): Promise<PullRequestLink | null> {
    const entry = cache.get(key);
    const fresh = entry && now() - entry.at < PULL_REQUEST_TTL_MS;
    const at = fresh ? entry.at : now();
    const link = fresh ? entry.link : lookUp();
    if (!fresh) cache.set(key, { at, link });
    return link.then((found) => found && newest(at, found));
  }

  return {
    find(remoteUrl, branch) {
      if (!remoteUrl || !branch) return Promise.resolve(null);
      if (deps.token() === INERT_GITHUB_TOKEN) return Promise.resolve(null);
      const github = parseGithubRepo(asHttps(remoteUrl));
      if (!github) return Promise.resolve(null);
      return cached(`${github.owner}/${github.repo}#${branch}`, () =>
        openOfBranch(github.owner, github.repo, branch),
      );
    },

    async states(links) {
      if (deps.token() === INERT_GITHUB_TOKEN) return [];
      const asked = links
        .map((link) => coordinatesOf(link.url))
        .filter((coordinates) => coordinates !== null);
      if (asked.length === 0) return [];
      const at = now();
      const variables = Object.fromEntries(
        asked.flatMap(({ owner, repo, number }, i) => [
          [`o${i}`, owner],
          [`r${i}`, repo],
          [`n${i}`, number],
        ]),
      );
      const data = await query(
        `${asked.length} pull request(s)`,
        byNumbers(asked.length),
        variables,
      );
      return asked.flatMap((_, i) => {
        const link = linkOf(
          data?.[`p${i}`]?.pullRequest as PullRequestNode | undefined,
        );
        return link ? [newest(at, link)] : [];
      });
    },
  };
}
