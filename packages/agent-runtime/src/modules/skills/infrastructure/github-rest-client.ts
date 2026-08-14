import type {
  GitHubErrorBody,
  Result,
  SkillsDomainError,
} from "agent-runtime-api";
import { err, ok } from "agent-runtime-api";

const GITHUB_API = "https://api.github.com";

const MAX_SKILL_FILE_BYTES = 1024 * 1024;

export interface DetectedOwnerRepo {
  owner: string;
  repo: string;
}

export function detectGithubOwnerRepo(
  gitUrl: string,
): DetectedOwnerRepo | null {
  const trimmed = gitUrl
    .replace(/\/+$/, "")
    .replace(/\.git$/, "")
    .replace(/\/+$/, "");
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

export interface PullRequestState {
  state: "open" | "closed";
  draft: boolean;
  mergedAt: string | null;
}

export interface GithubFetchOpts {
  withAuth?: boolean;
}

function repoPath(host: DetectedOwnerRepo): string {
  return `/repos/${encodeURIComponent(host.owner)}/${encodeURIComponent(host.repo)}`;
}

function encodePath(filePath: string): string {
  return filePath.split("/").map(encodeURIComponent).join("/");
}

export interface GitHubRestClient {
  getRepo: (
    host: DetectedOwnerRepo,
  ) => Promise<Result<RepoInfo, SkillsDomainError>>;
  getRef: (
    host: DetectedOwnerRepo,
    ref: string,
  ) => Promise<Result<CommitObject, SkillsDomainError>>;
  getCommitHead: (
    host: DetectedOwnerRepo,
    opts?: GithubFetchOpts,
  ) => Promise<Result<CommitObject, SkillsDomainError>>;
  getPullRequest: (
    host: DetectedOwnerRepo,
    number: number,
  ) => Promise<Result<PullRequestState, SkillsDomainError>>;
  getFileContent: (
    host: DetectedOwnerRepo,
    ref: string,
    filePath: string,
  ) => Promise<Result<string, SkillsDomainError>>;
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

export function createGitHubRestClient(): GitHubRestClient {
  return {
    async getRepo(host) {
      const r = await ghJson<{ default_branch: string }>("GET", repoPath(host));
      if (!r.ok) return r;
      return ok({ defaultBranch: r.value.default_branch });
    },
    async getRef(host, ref) {
      const r = await ghJson<{ object: { sha: string } }>(
        "GET",
        `${repoPath(host)}/git/refs/heads/${encodeURIComponent(ref)}`,
      );
      if (!r.ok) return r;
      return ok({ sha: r.value.object.sha });
    },
    async getCommitHead(host, opts) {
      const r = await ghJson<{ sha: string }>(
        "GET",
        `${repoPath(host)}/commits/HEAD`,
        undefined,
        opts,
      );
      if (!r.ok) return r;
      return ok({ sha: r.value.sha });
    },
    async getPullRequest(host, number) {
      const r = await ghJson<{
        state: string;
        draft?: boolean;
        merged_at?: string | null;
      }>("GET", `${repoPath(host)}/pulls/${number}`);
      if (!r.ok) return r;
      return ok({
        state:
          r.value.state === "closed" ? ("closed" as const) : ("open" as const),
        draft: r.value.draft ?? false,
        mergedAt: r.value.merged_at ?? null,
      });
    },
    async getFileContent(host, ref, filePath) {
      const r = await ghJson<{ content?: string; encoding?: string }>(
        "GET",
        `${repoPath(host)}/contents/${encodePath(filePath)}?ref=${encodeURIComponent(ref)}`,
      );
      if (!r.ok) return r;
      if (
        typeof r.value.content !== "string" ||
        r.value.encoding !== "base64"
      ) {
        return err({
          kind: "SourceFetchFailed",
          source: `${host.owner}/${host.repo}`,
          detail: `no readable file content at ${filePath}@${ref}`,
        });
      }
      const buf = Buffer.from(r.value.content, "base64");
      if (buf.byteLength > MAX_SKILL_FILE_BYTES) {
        return err({
          kind: "SourceFetchFailed",
          source: `${host.owner}/${host.repo}`,
          detail: `${filePath} too large: ${buf.byteLength} bytes`,
        });
      }
      return ok(buf.toString("utf8"));
    },
    async fetchTarball(host, sha, opts) {
      return await ghBytes(
        "GET",
        `${repoPath(host)}/tarball/${encodeURIComponent(sha)}`,
        opts,
      );
    },
    async createBlob(host, body) {
      const r = await ghJson<{ sha: string }>(
        "POST",
        `${repoPath(host)}/git/blobs`,
        body,
      );
      if (!r.ok) return r;
      return ok({ sha: r.value.sha });
    },
    async createTree(host, body) {
      const r = await ghJson<{ sha: string }>(
        "POST",
        `${repoPath(host)}/git/trees`,
        body,
      );
      if (!r.ok) return r;
      return ok({ sha: r.value.sha });
    },
    async createCommit(host, body) {
      const r = await ghJson<{ sha: string }>(
        "POST",
        `${repoPath(host)}/git/commits`,
        body,
      );
      if (!r.ok) return r;
      return ok({ sha: r.value.sha });
    },
    async createRef(host, body) {
      return await ghJson<unknown>("POST", `${repoPath(host)}/git/refs`, body);
    },
    async createPullRequest(host, body) {
      const r = await ghJson<{ html_url: string }>(
        "POST",
        `${repoPath(host)}/pulls`,
        body,
      );
      if (!r.ok) return r;
      return ok({ htmlUrl: r.value.html_url });
    },
  };
}

function ghHeaders(
  withAuth: boolean,
  hasBody: boolean,
): Record<string, string> {
  const token = process.env.GH_TOKEN ?? "dummy-placeholder";
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
  try {
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
  } catch (e) {
    return err(toUnreachableError(method, endpoint, e));
  }
}

async function ghBytes(
  method: "GET",
  endpoint: string,
  opts: GithubFetchOpts = {},
): Promise<Result<Uint8Array, SkillsDomainError>> {
  const withAuth = opts.withAuth ?? true;
  try {
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
  } catch (e) {
    return err(toUnreachableError(method, endpoint, e));
  }
}

function toUnreachableError(
  method: string,
  path: string,
  e: unknown,
): SkillsDomainError {
  const detail =
    e instanceof Error
      ? e.cause instanceof Error
        ? `${e.message}: ${e.cause.message}`
        : e.message
      : String(e);
  return { kind: "UpstreamUnreachable", method, path, detail };
}

function toUpstreamError(
  method: string,
  path: string,
  status: number,
  body: unknown,
): SkillsDomainError {
  const parsedBody: GitHubErrorBody = isErrorBody(body) ? body : {};
  return {
    kind: "UpstreamGitHubError",
    method,
    path,
    status,
    body: parsedBody,
  };
}

function isErrorBody(value: unknown): value is GitHubErrorBody {
  return typeof value === "object" && value !== null;
}

export function isUpstreamStatus(
  error: SkillsDomainError,
  status: number,
): boolean {
  return error.kind === "UpstreamGitHubError" && error.status === status;
}
