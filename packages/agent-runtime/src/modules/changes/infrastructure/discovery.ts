import { readdir, stat } from "node:fs/promises";
import { dirname, join } from "node:path";

import { RESERVED } from "../../workspace-path.js";
import {
  parseWorktreeList,
  type WorktreeRecord,
} from "../domain/git-output.js";
import { GIT_CONCURRENCY, mapLimit } from "../domain/map-limit.js";
import type { Git } from "./git.js";

export const SCAN_MAX_DEPTH = 4;
export const SCAN_MAX_DIRS = 20_000;

const SKIPPED_DIRS = new Set(["node_modules", ".git", ...RESERVED]);

export async function findRepositoryDirs(
  roots: readonly string[],
  opts: { maxDepth?: number; maxDirs?: number } = {},
): Promise<string[]> {
  const maxDepth = opts.maxDepth ?? SCAN_MAX_DEPTH;
  const maxDirs = opts.maxDirs ?? SCAN_MAX_DIRS;
  const found = new Set<string>();
  const visited = new Set<string>();
  const queue = roots.map((dir) => ({ dir, depth: 0 }));
  while (queue.length > 0 && visited.size < maxDirs) {
    const { dir, depth } = queue.shift()!;
    if (visited.has(dir)) continue;
    visited.add(dir);
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.name === ".git" && (entry.isDirectory() || entry.isFile()))
        found.add(dir);
      if (!entry.isDirectory() || SKIPPED_DIRS.has(entry.name)) continue;
      if (depth + 1 <= maxDepth)
        queue.push({ dir: join(dir, entry.name), depth: depth + 1 });
    }
  }
  return [...found];
}

export interface RepositoryLocation {
  toplevel: string;
  commonDir: string;
}

export async function locateRepository(
  git: Git,
  dir: string,
): Promise<RepositoryLocation | null> {
  const result = await git(dir, [
    "rev-parse",
    "--path-format=absolute",
    "--show-toplevel",
    "--git-common-dir",
  ]);
  if (!result.ok) return null;
  const [toplevel, commonDir] = result.value.trim().split("\n");
  return toplevel && commonDir ? { toplevel, commonDir } : null;
}

export async function nearestExistingDir(path: string): Promise<string | null> {
  let candidate = dirname(path);
  for (;;) {
    const info = await stat(candidate).catch(() => null);
    if (info?.isDirectory()) return candidate;
    const parent = dirname(candidate);
    if (parent === candidate) return null;
    candidate = parent;
  }
}

export async function locateFile(
  git: Git,
  path: string,
): Promise<RepositoryLocation | null> {
  const dir = await nearestExistingDir(path);
  if (dir === null) return null;
  const location = await locateRepository(git, dir);
  if (location === null) return null;
  const ignored = await git(dir, ["check-ignore", "--", path], {
    okExitCodes: [1],
  });
  return ignored.ok && ignored.value.trim() !== "" ? null : location;
}

export interface DiscoveredRepository {
  commonDir: string;
  worktrees: WorktreeRecord[];
}

export async function groupWorktrees(
  git: Git,
  locations: readonly RepositoryLocation[],
): Promise<DiscoveredRepository[]> {
  const byCommonDir = new Map<string, string>();
  for (const location of locations)
    if (!byCommonDir.has(location.commonDir))
      byCommonDir.set(location.commonDir, location.toplevel);
  const repositories = await mapLimit(
    [...byCommonDir],
    GIT_CONCURRENCY,
    async ([commonDir, toplevel]) => {
      const listed = await git(toplevel, ["worktree", "list", "--porcelain"]);
      const worktrees = listed.ok ? parseWorktreeList(listed.value) : [];
      return { commonDir, worktrees };
    },
  );
  return repositories.filter((repository) => repository.worktrees.length > 0);
}
