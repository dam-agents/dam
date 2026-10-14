import { open } from "node:fs/promises";
import { join } from "node:path";

import type { CompareTo, DiffStat, FileDiff } from "agent-runtime-api";

import {
  countPatchLines,
  parseNameStatus,
  parseNumstat,
  parseStatus,
  splitPatch,
  type StatusEntry,
  type WorktreeRecord,
} from "../domain/git-output.js";
import { EMPTY_TREE, type Git } from "./git.js";

export const MAX_UNTRACKED_FILES = 200;
export const MAX_PATCH_BYTES = 8 * 1024 * 1024;
export const MAX_FILE_PATCH_BYTES = 512 * 1024;
const MAX_COUNTED_FILE_BYTES = 1024 * 1024;

const DEFAULT_BRANCH_CANDIDATES = [
  "origin/main",
  "origin/master",
  "main",
  "master",
];

export async function defaultBranchRef(
  git: Git,
  cwd: string,
): Promise<string | null> {
  const symbolic = await git(cwd, [
    "symbolic-ref",
    "-q",
    "--short",
    "refs/remotes/origin/HEAD",
  ]);
  if (symbolic.ok && symbolic.value.trim()) return symbolic.value.trim();
  for (const candidate of DEFAULT_BRANCH_CANDIDATES) {
    const verified = await git(cwd, [
      "rev-parse",
      "--verify",
      "-q",
      `${candidate}^{commit}`,
    ]);
    if (verified.ok) return candidate;
  }
  return null;
}

export async function originUrl(git: Git, cwd: string): Promise<string | null> {
  const result = await git(cwd, ["remote", "get-url", "origin"]);
  return result.ok && result.value.trim() ? result.value.trim() : null;
}

export interface WorktreeState {
  path: string;
  branch: string | null;
  head: string | null;
  baseRef: string | null;
  baseSha: string | null;
  commitsAhead: number;
  stat: DiffStat;
  status: StatusEntry[];
}

async function readStatus(git: Git, path: string): Promise<StatusEntry[]> {
  const result = await git(path, [
    "status",
    "--porcelain=v1",
    "-z",
    "--untracked-files=all",
  ]);
  return result.ok ? parseStatus(result.value) : [];
}

async function lineCount(path: string): Promise<number> {
  const handle = await open(path, "r").catch(() => null);
  if (!handle) return 0;
  try {
    const buffer = Buffer.alloc(MAX_COUNTED_FILE_BYTES);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    const bytes = buffer.subarray(0, bytesRead);
    if (bytes.includes(0)) return 0;
    let lines = 0;
    for (const byte of bytes) if (byte === 0x0a) lines++;
    return bytesRead > 0 && bytes[bytesRead - 1] !== 0x0a ? lines + 1 : lines;
  } finally {
    await handle.close();
  }
}

function untrackedOf(status: readonly StatusEntry[]): StatusEntry[] {
  return status.filter((entry) => entry.untracked);
}

export async function readWorktree(
  git: Git,
  record: WorktreeRecord,
  defaultRef: string | null,
): Promise<WorktreeState> {
  const { path, head, branch } = record;
  const mergeBase =
    head && defaultRef
      ? await git(path, ["merge-base", "HEAD", defaultRef])
      : null;
  const baseSha = mergeBase?.ok ? mergeBase.value.trim() || null : null;
  const ahead = baseSha
    ? await git(path, ["rev-list", "--count", `${baseSha}..HEAD`])
    : null;
  const status = await readStatus(git, path);
  const ref = baseSha ?? head ?? EMPTY_TREE;
  const numstat = await git(path, ["diff", "--numstat", "-z", "-M", ref, "--"]);
  const tracked = numstat.ok ? parseNumstat(numstat.value) : [];
  const untracked = untrackedOf(status).slice(0, MAX_UNTRACKED_FILES);
  const untrackedLines = await Promise.all(
    untracked.map((entry) => lineCount(join(path, entry.path))),
  );
  return {
    path,
    branch,
    head,
    baseRef: baseSha ? defaultRef : null,
    baseSha,
    commitsAhead: ahead?.ok ? Number(ahead.value.trim()) || 0 : 0,
    stat: {
      files: tracked.length + untracked.length,
      additions:
        tracked.reduce((sum, entry) => sum + entry.additions, 0) +
        untrackedLines.reduce((sum, lines) => sum + lines, 0),
      deletions: tracked.reduce((sum, entry) => sum + entry.deletions, 0),
    },
    status,
  };
}

const PATCH_FLAGS = [
  "--no-ext-diff",
  "--no-textconv",
  "-M",
  "--src-prefix=a/",
  "--dst-prefix=b/",
];

function fitted(patch: string | undefined): string | null {
  if (patch === undefined) return null;
  return Buffer.byteLength(patch) > MAX_FILE_PATCH_BYTES ? null : patch;
}

async function untrackedDiff(
  git: Git,
  cwd: string,
  path: string,
): Promise<FileDiff> {
  const result = await git(
    cwd,
    ["diff", "--no-index", ...PATCH_FLAGS, "--", "/dev/null", path],
    { okExitCodes: [1], maxOutputBytes: MAX_FILE_PATCH_BYTES * 2 },
  );
  const patch = result.ok ? fitted(result.value) : null;
  const binary = patch !== null && /^Binary files /m.test(patch);
  const counted = patch && !binary ? countPatchLines(patch) : null;
  return {
    path,
    oldPath: null,
    status: "added",
    additions: counted?.additions ?? 0,
    deletions: 0,
    binary,
    uncommitted: true,
    patch,
  };
}

export interface WorktreeDiff {
  baseRef: string | null;
  files: FileDiff[];
  truncated: boolean;
}

export async function readDiff(
  git: Git,
  state: WorktreeState,
  compare: CompareTo,
): Promise<WorktreeDiff> {
  const { path } = state;
  const ref =
    compare === "base"
      ? (state.baseSha ?? state.head ?? EMPTY_TREE)
      : (state.head ?? EMPTY_TREE);
  const [numstat, nameStatus, patch] = await Promise.all([
    git(path, ["diff", "--numstat", "-z", "-M", ref, "--"]),
    git(path, ["diff", "--name-status", "-z", "-M", ref, "--"]),
    git(path, ["diff", ...PATCH_FLAGS, ref, "--"], {
      maxOutputBytes: MAX_PATCH_BYTES,
    }),
  ]);
  const statuses = nameStatus.ok
    ? parseNameStatus(nameStatus.value)
    : new Map();
  const patches = patch.ok
    ? splitPatch(patch.value)
    : new Map<string, string>();
  const changed = new Set(state.status.map((entry) => entry.path));
  const tracked: FileDiff[] = (
    numstat.ok ? parseNumstat(numstat.value) : []
  ).map((entry) => ({
    path: entry.path,
    oldPath: entry.oldPath,
    status: statuses.get(entry.path) ?? "modified",
    additions: entry.additions,
    deletions: entry.deletions,
    binary: entry.binary,
    uncommitted:
      changed.has(entry.path) ||
      (entry.oldPath !== null && changed.has(entry.oldPath)),
    patch: fitted(patches.get(entry.path)),
  }));
  const untracked = untrackedOf(state.status);
  const shown = untracked.slice(0, MAX_UNTRACKED_FILES);
  const added = await Promise.all(
    shown.map((entry) => untrackedDiff(git, path, entry.path)),
  );
  const files = [...tracked, ...added].sort((a, b) =>
    a.path < b.path ? -1 : a.path > b.path ? 1 : 0,
  );
  return {
    baseRef: compare === "base" ? state.baseRef : "HEAD",
    files,
    truncated:
      !patch.ok ||
      untracked.length > shown.length ||
      files.some((file) => file.patch === null && !file.binary),
  };
}
