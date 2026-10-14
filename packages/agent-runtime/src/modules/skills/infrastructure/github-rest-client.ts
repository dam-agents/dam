import { createHash } from "node:crypto";
import * as path from "node:path";
import type {
  GitHubErrorBody,
  Result,
  SkillsDomainError,
} from "agent-runtime-api";
import { err, ok, parseGithubRepo } from "agent-runtime-api";

const GITHUB_API = "https://api.github.com";

const MAX_SKILL_FILE_BYTES = 1024 * 1024;

export const MAX_SUBTREE_REQUESTS = 200;

const MAX_LINK_HOPS = 16;

export interface DetectedOwnerRepo {
  owner: string;
  repo: string;
}

export function detectGithubOwnerRepo(
  gitUrl: string,
): DetectedOwnerRepo | null {
  return parseGithubRepo(gitUrl);
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

export interface SubtreeFile {
  path: string;
  bytes: Uint8Array;
}

interface ContentsEntry {
  type: string;
  path: string;
  sha: string;
  size: number;
  download_url: string | null;
}

interface ContentsFile {
  type: string;
  content?: string;
  encoding?: string;
}

export interface ResolvedDir {
  path: string;
  hasManifest: boolean;
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
  resolveDir: (
    host: DetectedOwnerRepo,
    ref: string,
    dirPath: string,
    opts?: GithubFetchOpts,
  ) => Promise<Result<ResolvedDir, SkillsDomainError>>;
  fetchSubtree: (
    host: DetectedOwnerRepo,
    ref: string,
    dirPath: string,
    opts?: GithubFetchOpts,
    placeAt?: string,
  ) => Promise<Result<SubtreeFile[], SkillsDomainError>>;
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

export function createGitHubRestClient(clientOpts: {
  token: () => string;
}): GitHubRestClient {
  const { token } = clientOpts;
  const json = <T>(
    method: "GET" | "POST",
    endpoint: string,
    body?: unknown,
    opts: GithubFetchOpts = {},
  ) => ghJson<T>(method, endpoint, token, body, opts);
  const bytes = (method: "GET", endpoint: string, opts: GithubFetchOpts = {}) =>
    ghBytes(method, endpoint, token, opts);
  return {
    async getRepo(host) {
      const r = await json<{ default_branch: string }>("GET", repoPath(host));
      if (!r.ok) return r;
      return ok({ defaultBranch: r.value.default_branch });
    },
    async getRef(host, ref) {
      const r = await json<{ object: { sha: string } }>(
        "GET",
        `${repoPath(host)}/git/refs/heads/${encodeURIComponent(ref)}`,
      );
      if (!r.ok) return r;
      return ok({ sha: r.value.object.sha });
    },
    async getCommitHead(host, opts) {
      const r = await json<{ sha: string }>(
        "GET",
        `${repoPath(host)}/commits/HEAD`,
        undefined,
        opts,
      );
      if (!r.ok) return r;
      return ok({ sha: r.value.sha });
    },
    async getPullRequest(host, number) {
      const r = await json<{
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
      const r = await json<{ content?: string; encoding?: string }>(
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
      return await bytes(
        "GET",
        `${repoPath(host)}/tarball/${encodeURIComponent(sha)}`,
        opts,
      );
    },
    async resolveDir(host, ref, dirPath, opts) {
      const fail = sourceFetchFailed(host);
      let hops = 0;
      const visit = async (
        p: string,
      ): Promise<Result<ResolvedDir, SkillsDomainError>> => {
        if (++hops > MAX_LINK_HOPS) {
          return fail(`${dirPath}@${ref} has too many symlinks to resolve`);
        }
        const r = await json<unknown>(
          "GET",
          contentsPath(host, ref, p),
          undefined,
          opts,
        );
        if (r.ok) {
          if (Array.isArray(r.value)) {
            const entries = r.value as ContentsEntry[];
            const hasManifest = entries.some(
              (e) => e.type === "file" && e.path === `${p}/SKILL.md`,
            );
            return ok({ path: p, hasManifest });
          }
          const target = symlinkTarget(p, r.value);
          return target === null
            ? fail(`${p}@${ref} is not a directory`)
            : visit(target);
        }
        const parentPath = path.posix.dirname(p);
        if (!isNotFound(r) || parentPath === ".") return r;
        const parent = await visit(parentPath);
        if (!parent.ok || parent.value.path === parentPath) return r;
        return visit(
          path.posix.join(parent.value.path, path.posix.basename(p)),
        );
      };
      return visit(dirPath);
    },
    async fetchSubtree(host, ref, dirPath, opts, placeAt = dirPath) {
      const fail = sourceFetchFailed(host);
      const contents = (p: string) => contentsPath(host, ref, p);
      let requests = 0;
      const spend = (n: number) => {
        requests += n;
        return requests <= MAX_SUBTREE_REQUESTS;
      };
      const overBudget = () =>
        fail(
          `${dirPath}@${ref} needs more than ${MAX_SUBTREE_REQUESTS} requests to fetch`,
        );

      const files: SubtreeFile[] = [];
      const pending = [{ src: dirPath, dst: placeAt, viaLink: false }];
      while (pending.length > 0) {
        const { src, dst, viaLink } = pending.pop()!;
        if (!spend(1)) return overBudget();
        const listing = await json<unknown>(
          "GET",
          contents(src),
          undefined,
          opts,
        );
        if (!listing.ok) {
          if (viaLink && isNotFound(listing)) continue;
          return listing;
        }
        if (!Array.isArray(listing.value)) {
          const target = symlinkTarget(src, listing.value);
          if (target !== null)
            pending.push({ src: target, dst, viaLink: true });
          else if (!viaLink) return fail(`${src}@${ref} is not a directory`);
          continue;
        }
        const blobs: { entry: ContentsEntry; dst: string }[] = [];
        for (const entry of listing.value as ContentsEntry[]) {
          const at = `${dst}/${path.posix.basename(entry.path)}`;
          if (entry.type === "dir" || entry.type === "symlink") {
            pending.push({
              src: entry.path,
              dst: at,
              viaLink: entry.type === "symlink",
            });
          } else if (entry.type === "file" && entry.download_url !== null) {
            blobs.push({ entry, dst: at });
          }
        }
        const oversize = blobs.find((b) => b.entry.size > MAX_SKILL_FILE_BYTES);
        if (oversize) {
          return fail(
            `${oversize.entry.path} too large: ${oversize.entry.size} bytes`,
          );
        }
        if (!spend(blobs.length)) return overBudget();
        const fetched = await Promise.all(
          blobs.map(async ({ entry, dst: at }) => {
            const r = await json<ContentsFile>(
              "GET",
              contents(entry.path),
              undefined,
              opts,
            );
            if (!r.ok) return r;
            if (
              r.value.type !== "file" ||
              typeof r.value.content !== "string" ||
              r.value.encoding !== "base64"
            ) {
              return ok(null);
            }
            const bytes = Buffer.from(r.value.content, "base64");
            if (bytes.byteLength > MAX_SKILL_FILE_BYTES) {
              return fail(`${entry.path} too large: ${bytes.byteLength} bytes`);
            }
            return ok(
              gitBlobSha(bytes) === entry.sha
                ? { path: at, bytes: new Uint8Array(bytes) }
                : null,
            );
          }),
        );
        for (const r of fetched) {
          if (!r.ok) return r;
          if (r.value) files.push(r.value);
        }
      }
      return ok(files);
    },
    async createBlob(host, body) {
      const r = await json<{ sha: string }>(
        "POST",
        `${repoPath(host)}/git/blobs`,
        body,
      );
      if (!r.ok) return r;
      return ok({ sha: r.value.sha });
    },
    async createTree(host, body) {
      const r = await json<{ sha: string }>(
        "POST",
        `${repoPath(host)}/git/trees`,
        body,
      );
      if (!r.ok) return r;
      return ok({ sha: r.value.sha });
    },
    async createCommit(host, body) {
      const r = await json<{ sha: string }>(
        "POST",
        `${repoPath(host)}/git/commits`,
        body,
      );
      if (!r.ok) return r;
      return ok({ sha: r.value.sha });
    },
    async createRef(host, body) {
      return await json<unknown>("POST", `${repoPath(host)}/git/refs`, body);
    },
    async createPullRequest(host, body) {
      const r = await json<{ html_url: string }>(
        "POST",
        `${repoPath(host)}/pulls`,
        body,
      );
      if (!r.ok) return r;
      return ok({ htmlUrl: r.value.html_url });
    },
  };
}

function contentsPath(
  host: DetectedOwnerRepo,
  ref: string,
  filePath: string,
): string {
  return `${repoPath(host)}/contents/${encodePath(filePath)}?ref=${encodeURIComponent(ref)}`;
}

function sourceFetchFailed(host: DetectedOwnerRepo) {
  return (detail: string) =>
    err<SkillsDomainError>({
      kind: "SourceFetchFailed",
      source: `${host.owner}/${host.repo}`,
      detail,
    });
}

function isNotFound(res: Result<unknown, SkillsDomainError>): boolean {
  return (
    !res.ok &&
    res.error.kind === "UpstreamGitHubError" &&
    res.error.status === 404
  );
}

function symlinkTarget(linkPath: string, body: unknown): string | null {
  const link = body as { type?: string; target?: unknown };
  if (link?.type !== "symlink" || typeof link.target !== "string") return null;
  if (link.target.startsWith("/")) return null;
  const resolved = path.posix.normalize(
    path.posix.join(path.posix.dirname(linkPath), link.target),
  );
  return resolved === ".." || resolved.startsWith("../") ? null : resolved;
}

function gitBlobSha(bytes: Buffer): string {
  return createHash("sha1")
    .update(`blob ${bytes.byteLength}\0`)
    .update(bytes)
    .digest("hex");
}

function ghHeaders(
  withAuth: boolean,
  hasBody: boolean,
  token: () => string,
): Record<string, string> {
  return {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    ...(withAuth ? { Authorization: `Bearer ${token()}` } : {}),
    ...(hasBody ? { "Content-Type": "application/json" } : {}),
  };
}

async function ghJson<T>(
  method: "GET" | "POST",
  endpoint: string,
  token: () => string,
  body?: unknown,
  opts: GithubFetchOpts = {},
): Promise<Result<T, SkillsDomainError>> {
  const withAuth = opts.withAuth ?? true;
  try {
    const res = await fetch(`${GITHUB_API}${endpoint}`, {
      method,
      headers: ghHeaders(withAuth, body !== undefined, token),
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
  token: () => string,
  opts: GithubFetchOpts = {},
): Promise<Result<Uint8Array, SkillsDomainError>> {
  const withAuth = opts.withAuth ?? true;
  try {
    const res = await fetch(`${GITHUB_API}${endpoint}`, {
      method,
      headers: ghHeaders(withAuth, false, token),
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
