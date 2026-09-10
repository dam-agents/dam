import * as fs from "node:fs/promises";
import * as path from "node:path";

export interface CatalogSource {
  readonly locator: string;
  readText(relPath: string): Promise<string | null>;
}

const MAX_FILE_BYTES = 256 * 1024;

export function relPathEscapes(relPath: string): boolean {
  return path.isAbsolute(relPath) || relPath.split(/[\\/]/).includes("..");
}

export function createLocalCatalogSource(dir: string): CatalogSource {
  const root = path.resolve(dir);
  return {
    locator: root,
    async readText(relPath) {
      if (relPathEscapes(relPath)) return null;
      try {
        const buf = await fs.readFile(path.join(root, relPath));
        return buf.byteLength > MAX_FILE_BYTES ? null : buf.toString("utf8");
      } catch (err) {
        const code = (err as { code?: string }).code;
        if (code === "ENOENT" || code === "ENOTDIR" || code === "EISDIR")
          return null;
        throw err;
      }
    },
  };
}

export interface GithubLocator {
  owner: string;
  repo: string;
  ref?: string;
  dir?: string;
}

export function parseGithubRepoUrl(url: string): GithubLocator | null {
  const [base, fragment] = url.split("#", 2);
  const trimmed = base.replace(/\/+$/, "").replace(/\.git$/, "");
  const tree =
    /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/tree\/([^/]+)\/(.+)$/.exec(
      trimmed,
    );
  if (tree) {
    if (relPathEscapes(tree[4])) return null;
    return { owner: tree[1], repo: tree[2], ref: tree[3], dir: tree[4] };
  }
  const m = /^https:\/\/github\.com\/([^/]+)\/([^/]+)$/.exec(trimmed);
  if (!m) return null;
  return { owner: m[1], repo: m[2], ...(fragment ? { ref: fragment } : {}) };
}

export function createGithubCatalogSource(
  gitUrl: string,
  ref = "HEAD",
  fetchImpl: typeof fetch = fetch,
  dir?: string,
): CatalogSource {
  const repo = parseGithubRepoUrl(gitUrl);
  if (!repo) throw new Error(`not a GitHub repository URL: ${gitUrl}`);
  const base = `https://raw.githubusercontent.com/${repo.owner}/${repo.repo}/${encodeURIComponent(ref)}`;
  const prefix = (dir ?? repo.dir ?? "")
    .split("/")
    .filter((seg) => seg && seg !== ".");
  return {
    locator: `https://github.com/${repo.owner}/${repo.repo}#${ref}${prefix.length ? `:${prefix.join("/")}` : ""}`,
    async readText(relPath) {
      if (relPathEscapes(relPath)) return null;
      const clean = [
        ...prefix,
        ...relPath.split("/").filter((seg) => seg && seg !== "."),
      ];
      const res = await fetchImpl(`${base}/${clean.join("/")}`);
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`github raw ${res.status} for ${gitUrl}`);
      const buf = Buffer.from(await res.arrayBuffer());
      return buf.byteLength > MAX_FILE_BYTES ? null : buf.toString("utf8");
    },
  };
}

export function createCatalogSourceFromLocator(
  locator: string,
): CatalogSource | null {
  if (!locator) return null;
  const gh = parseGithubRepoUrl(locator);
  if (gh)
    return createGithubCatalogSource(
      `https://github.com/${gh.owner}/${gh.repo}`,
      gh.ref,
      fetch,
      gh.dir,
    );
  return createLocalCatalogSource(locator);
}
