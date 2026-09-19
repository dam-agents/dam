import * as path from "node:path";

import { OVER_BUDGET, readFileWithin, readTextWithin } from "./bounded-read.js";

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
      const full = path.join(root, relPath);
      const text = await readFileWithin(full, MAX_FILE_BYTES);
      if (text === OVER_BUDGET)
        throw new Error(`${full} is larger than ${MAX_FILE_BYTES} bytes`);
      return text;
    },
  };
}

export interface GithubLocator {
  owner: string;
  repo: string;
}

export function parseGithubRepoUrl(url: string): GithubLocator | null {
  if (url.includes("#")) return null;
  const trimmed = url.replace(/\/+$/, "").replace(/\.git$/, "");
  if (/^https:\/\/github\.com\/[^/]+\/[^/]+\/tree\//.test(trimmed)) return null;
  const m = /^https:\/\/github\.com\/([^/]+)\/([^/]+)$/.exec(trimmed);
  if (!m) return null;
  return { owner: m[1], repo: m[2] };
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
  const prefix = (dir ?? "").split("/").filter((seg) => seg && seg !== ".");
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
      const text = await readTextWithin(res, MAX_FILE_BYTES);
      if (text === null)
        throw new Error(
          `${relPath} is larger than ${MAX_FILE_BYTES} bytes at ${gitUrl}`,
        );
      return text;
    },
  };
}

export interface LocatedCatalog {
  source: CatalogSource;
  gitUrl?: string;
  ref?: string;
}

export type CatalogLocatorKind = "url" | "path";

export function createCatalogSourceFromLocator(
  locator: string,
  kind: CatalogLocatorKind,
  ref?: string,
  dir?: string,
): LocatedCatalog | null {
  if (!locator) return null;
  if (kind === "path") return { source: createLocalCatalogSource(locator) };
  const gh = parseGithubRepoUrl(locator);
  if (!gh) return null;
  const gitUrl = `https://github.com/${gh.owner}/${gh.repo}`;
  return {
    source: createGithubCatalogSource(gitUrl, ref, fetch, dir),
    gitUrl,
    ...(ref ? { ref } : {}),
  };
}
