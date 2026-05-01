import type { GitHubErrorBody, Result, SkillsDomainError } from "agent-runtime-api";
import { err, ok } from "agent-runtime-api";

const GITHUB_API = "https://api.github.com";

export interface DetectedOwnerRepo {
  owner: string;
  repo: string;
}

/**
 * Mirrors api-server's `detectHost` but inline — agent-runtime avoids a
 * cross-package dependency. Only GitHub is recognized; other hosts skip the
 * pre-flight and fall through to an anonymous clone.
 */
export function detectGithubOwnerRepo(gitUrl: string): DetectedOwnerRepo | null {
  const trimmed = gitUrl.replace(/\/+$/, "").replace(/\.git$/, "").replace(/\/+$/, "");
  const m = /^https:\/\/github\.com\/([^/]+)\/([^/]+)$/.exec(trimmed);
  return m ? { owner: m[1], repo: m[2] } : null;
}

export interface RepoInfo {
  defaultBranch: string;
}

export interface CommitObject {
  sha: string;
}

export interface BlobRef {
  sha: string;
}

export interface TreeEntry {
  path: string;
  mode: "100644";
  type: "blob";
  sha: string;
}

export interface PullRequest {
  htmlUrl: string;
}

export interface GithubFetchOpts {
  withAuth?: boolean;
}

/**
 * Thin port over `api.github.com`. Sequencing of these primitives (publish's
 * blob → tree → commit → ref → PR; scan's commit → tarball) is application
 * concern, not the port's. Auth toggle (`withAuth`) is exposed so the scan
 * service can do anonymous-first, retry-with-sentinel-on-404.
 */
export interface GitHubRestClient {
  getRepo: (host: DetectedOwnerRepo) => Promise<Result<RepoInfo, SkillsDomainError>>;
  getRef: (
    host: DetectedOwnerRepo,
    ref: string,
  ) => Promise<Result<CommitObject, SkillsDomainError>>;
  getCommitHead: (
    host: DetectedOwnerRepo,
    opts?: GithubFetchOpts,
  ) => Promise<Result<CommitObject, SkillsDomainError>>;
  fetchTarball: (
    host: DetectedOwnerRepo,
    sha: string,
    opts?: GithubFetchOpts,
  ) => Promise<Result<Uint8Array, SkillsDomainError>>;
  createBlob: (
    host: DetectedOwnerRepo,
    body: { content: string; encoding: "utf-8" | "base64" },
  ) => Promise<Result<BlobRef, SkillsDomainError>>;
  createTree: (
    host: DetectedOwnerRepo,
    body: { base_tree: string; tree: TreeEntry[] },
  ) => Promise<Result<{ sha: string }, SkillsDomainError>>;
  createCommit: (
    host: DetectedOwnerRepo,
    body: {
      message: string;
      tree: string;
      parents: string[];
      author: { name: string; email: string };
    },
  ) => Promise<Result<{ sha: string }, SkillsDomainError>>;
  createRef: (
    host: DetectedOwnerRepo,
    body: { ref: string; sha: string },
  ) => Promise<Result<unknown, SkillsDomainError>>;
  createPullRequest: (
    host: DetectedOwnerRepo,
    body: { title: string; body: string; head: string; base: string },
  ) => Promise<Result<PullRequest, SkillsDomainError>>;
}

/**
 * Adapter that talks to `api.github.com` through OneCLI's HTTPS proxy.
 *
 * `withAuth: true` attaches the sentinel bearer (`humr:sentinel` unless
 * `GH_TOKEN` overrides) — OneCLI's MITM swaps it for the user's OAuth token.
 * Needed for mutations and for endpoints whose 404-on-unauthenticated path is
 * ambiguous (we'd rather get the structured `app_not_connected` CTA).
 *
 * `withAuth: false` sends no Authorization header. OneCLI passes anonymous
 * reads through for public resources and *still* injects the user's token
 * automatically when they're Connected. The hard-requirement path for scan:
 * public repos must work even when the user hasn't Connected GitHub yet.
 */
export function createGitHubRestClient(): GitHubRestClient {
  return {
    async getRepo(host) {
      const r = await ghJson<{ default_branch: string }>("GET", `/repos/${host.owner}/${host.repo}`);
      if (!r.ok) return r;
      return ok({ defaultBranch: r.value.default_branch });
    },
    async getRef(host, ref) {
      const r = await ghJson<{ object: { sha: string } }>(
        "GET",
        `/repos/${host.owner}/${host.repo}/git/refs/heads/${encodeURIComponent(ref)}`,
      );
      if (!r.ok) return r;
      return ok({ sha: r.value.object.sha });
    },
    async getCommitHead(host, opts) {
      const r = await ghJson<{ sha: string }>(
        "GET",
        `/repos/${host.owner}/${host.repo}/commits/HEAD`,
        undefined,
        opts,
      );
      if (!r.ok) return r;
      return ok({ sha: r.value.sha });
    },
    async fetchTarball(host, sha, opts) {
      return await ghBytes(
        "GET",
        `/repos/${host.owner}/${host.repo}/tarball/${encodeURIComponent(sha)}`,
        opts,
      );
    },
    async createBlob(host, body) {
      const r = await ghJson<{ sha: string }>(
        "POST",
        `/repos/${host.owner}/${host.repo}/git/blobs`,
        body,
      );
      if (!r.ok) return r;
      return ok({ sha: r.value.sha });
    },
    async createTree(host, body) {
      const r = await ghJson<{ sha: string }>(
        "POST",
        `/repos/${host.owner}/${host.repo}/git/trees`,
        body,
      );
      if (!r.ok) return r;
      return ok({ sha: r.value.sha });
    },
    async createCommit(host, body) {
      const r = await ghJson<{ sha: string }>(
        "POST",
        `/repos/${host.owner}/${host.repo}/git/commits`,
        body,
      );
      if (!r.ok) return r;
      return ok({ sha: r.value.sha });
    },
    async createRef(host, body) {
      return await ghJson<unknown>("POST", `/repos/${host.owner}/${host.repo}/git/refs`, body);
    },
    async createPullRequest(host, body) {
      const r = await ghJson<{ html_url: string }>(
        "POST",
        `/repos/${host.owner}/${host.repo}/pulls`,
        body,
      );
      if (!r.ok) return r;
      return ok({ htmlUrl: r.value.html_url });
    },
  };
}

function ghHeaders(withAuth: boolean, hasBody: boolean): Record<string, string> {
  const token = process.env.GH_TOKEN ?? "humr:sentinel";
  return {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    ...(withAuth ? { Authorization: `Bearer ${token}` } : {}),
    ...(hasBody ? { "Content-Type": "application/json" } : {}),
  };
}

async function ghJson<T>(
  method: "GET" | "POST",
  endpoint: string,
  body?: unknown,
  opts: GithubFetchOpts = {},
): Promise<Result<T, SkillsDomainError>> {
  const withAuth = opts.withAuth ?? true;
  const res = await fetch(`${GITHUB_API}${endpoint}`, {
    method,
    headers: ghHeaders(withAuth, body !== undefined),
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let parsed: unknown = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = text;
  }
  if (!res.ok) {
    return err(toUpstreamError(method, endpoint, res.status, parsed));
  }
  return ok(parsed as T);
}

async function ghBytes(
  method: "GET",
  endpoint: string,
  opts: GithubFetchOpts = {},
): Promise<Result<Uint8Array, SkillsDomainError>> {
  const withAuth = opts.withAuth ?? true;
  const res = await fetch(`${GITHUB_API}${endpoint}`, {
    method,
    headers: ghHeaders(withAuth, false),
  });
  if (!res.ok) {
    let parsed: unknown = null;
    const text = await res.text().catch(() => "");
    try {
      parsed = text ? JSON.parse(text) : text;
    } catch {
      parsed = text;
    }
    return err(toUpstreamError(method, endpoint, res.status, parsed));
  }
  return ok(new Uint8Array(await res.arrayBuffer()));
}

function toUpstreamError(
  method: string,
  path: string,
  status: number,
  body: unknown,
): SkillsDomainError {
  const parsedBody: GitHubErrorBody = isErrorBody(body) ? body : {};
  return { kind: "UpstreamGitHubError", method, path, status, body: parsedBody };
}

function isErrorBody(value: unknown): value is GitHubErrorBody {
  return typeof value === "object" && value !== null;
}

/** Helper: extract the `status` from an UpstreamGitHubError so services can
 *  branch on 404-vs-other for the "anonymous → retry with auth" pattern. */
export function isUpstreamStatus(error: SkillsDomainError, status: number): boolean {
  return error.kind === "UpstreamGitHubError" && error.status === status;
}
