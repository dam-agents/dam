import * as path from "node:path";

import { OVER_BUDGET, readFileWithin, readTextWithin } from "./bounded-read.js";
import type { GitHosts } from "./git-hosts.js";

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

export function createGitCatalogSource(
  hosts: GitHosts,
  gitUrl: string,
  ref = "HEAD",
  fetchImpl: typeof fetch = fetch,
  dir?: string,
): CatalogSource {
  const repo = hosts.locate(gitUrl);
  if (!repo)
    throw new Error(
      `not a repository URL this install may read: ${gitUrl} (readable hosts: ${hosts.readableHosts.join(", ")})`,
    );
  const prefix = (dir ?? "").split("/").filter((seg) => seg && seg !== ".");
  return {
    locator: `${repo.gitUrl}#${ref}${prefix.length ? `:${prefix.join("/")}` : ""}`,
    async readText(relPath) {
      if (relPathEscapes(relPath)) return null;
      const clean = [
        ...prefix,
        ...relPath.split("/").filter((seg) => seg && seg !== "."),
      ];
      const request = repo.file(ref, clean);
      const res = await fetchImpl(request.url, { headers: request.headers });
      if (res.status === 404) return null;
      if (!res.ok)
        throw new Error(`${repo.host} returned ${res.status} for ${gitUrl}`);
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
  hosts: GitHosts,
  locator: string,
  kind: CatalogLocatorKind,
  ref?: string,
  dir?: string,
): LocatedCatalog | null {
  if (!locator) return null;
  if (kind === "path") return { source: createLocalCatalogSource(locator) };
  const repo = hosts.locate(locator);
  if (!repo) return null;
  return {
    source: createGitCatalogSource(hosts, repo.gitUrl, ref, fetch, dir),
    gitUrl: repo.gitUrl,
    ...(ref ? { ref } : {}),
  };
}
