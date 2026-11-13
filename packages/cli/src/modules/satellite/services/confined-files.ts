import { createHash, randomBytes } from "node:crypto";
import { constants } from "node:fs";
import {
  linkSync,
  lstatSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
} from "node:fs";
import type { Dir, Stats } from "node:fs";
import type { FileHandle } from "node:fs/promises";
import {
  lstat,
  mkdir,
  opendir,
  open,
  realpath,
  unlink,
} from "node:fs/promises";
import { homedir } from "node:os";
import { basename, isAbsolute, join, relative, resolve, sep } from "node:path";

/**
 * UNIT_BOUNDARY_DESCRIPTION: A file on the user's machine read or written
 * through one directory, without trusting a path component. The machine is the
 * user's own, but the caller is a prompt-injectable Agent, so a transfer must not
 * be steerable outside the root: every directory on the way is `lstat`ed and must
 * be real, a file is opened with `O_NOFOLLOW` and `O_NONBLOCK` (so a FIFO cannot
 * hang the worker), and the descriptor is compared with the path it was opened by
 * — same device and inode, a regular file, one link.
 *
 * A write is staged under a random name beside its destination and published by
 * one step taken *inside* the verified destination directory: the process moves
 * into that directory's inode, proves it is still the one that was checked, and
 * then names the file relatively. No other JavaScript can run between the proof
 * and the step, so renaming a path on top of it cannot redirect the step — the
 * guarantee `linkat`/`renameat` give, which Node does not expose.
 *
 * The ceilings, stated: the working directory is process-wide while the step
 * runs, so code on another thread using a relative path would see it (this
 * package has none); a process of the same user can still swap the staged name
 * between the proof and the link, which is detected afterwards and leaves
 * nothing published; and if the directory this worker was started in is deleted,
 * restoring the working directory fails and that upload fails after staging.
 * The upgrade path for all three is a native `linkat`/`renameat`/`openat2`.
 */

export function platformRefusal(): string | null {
  return process.platform === "win32"
    ? "a files satellite needs a POSIX machine — this build cannot confine a path on Windows"
    : null;
}

export type Refusal =
  | "outside"
  | "not-a-file"
  | "exists"
  | "no-such-file"
  | "not-writable"
  | "changed";

export type Opened =
  | { ok: true; handle: FileHandle; size: number }
  | { ok: false; reason: Refusal };

export type FileKind = "file" | "dir" | "link" | "other";

function kindOf(info: Stats): FileKind {
  if (info.isSymbolicLink()) return "link";
  if (info.isDirectory()) return "dir";
  if (info.isFile()) return "file";
  return "other";
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: The root as it was typed is refused unless it is a
 * real directory, and every later call re-resolves it, so a root replaced by a
 * link after the worker started stops being a root instead of silently becoming
 * a different directory.
 */
export async function pinRoot(
  raw: string,
): Promise<{ ok: true; root: string } | { ok: false; reason: string }> {
  const home = await realpath(homedir()).catch(() => homedir());
  const root = await realpath(raw).catch(() => null);
  if (root === null) return { ok: false, reason: `there is no ${raw}` };
  const info = await lstat(root).catch(() => null);
  if (info === null || !info.isDirectory())
    return { ok: false, reason: `${raw} is not a directory` };
  if (root === sep)
    return { ok: false, reason: "name a directory, not the whole filesystem" };
  if (home === root)
    return {
      ok: false,
      reason:
        "name the directory the agent may read, not your home directory — it is all of it",
    };
  if (home.startsWith(root + sep))
    return {
      ok: false,
      reason: `name the directory the agent may read, not ${root} — your home directory is inside it`,
    };
  return { ok: true, root };
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: A path relative to the root, as segments, or null
 * when it cannot name anything inside it: empty, absolute, longer than the cap,
 * carrying a NUL, a `..`, a `.`, a doubled separator, or a backslash this POSIX
 * machine would read as part of a name while a reader of the manual would not.
 */
export function pathSegments(raw: unknown): string[] | null {
  if (typeof raw !== "string") return null;
  if (raw === "" || raw.length > 1024) return null;
  if (raw.includes("\0") || raw.includes("\\")) return null;
  if (isAbsolute(raw)) return null;
  const segments = raw.split("/");
  if (segments.some((s) => s === "" || s === "." || s === "..")) return null;
  return segments;
}

interface Proved {
  dev: number;
  ino: number;
}

async function sameFile(handle: FileHandle, path: string): Promise<boolean> {
  const opened = await handle.stat();
  if (!opened.isFile() || opened.nlink !== 1) return false;
  const real = await realpath(path).catch(() => null);
  if (real !== path) return false;
  const entry = await lstat(path).catch(() => null);
  return entry !== null && entry.dev === opened.dev && entry.ino === opened.ino;
}

export async function realDirectory(path: string): Promise<boolean> {
  const entry = await lstat(path).catch(() => null);
  if (entry === null || !entry.isDirectory() || entry.isSymbolicLink())
    return false;
  return (await realpath(path).catch(() => null)) === path;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: Joins validated segments under a root and refuses
 * the result unless it stays inside it. The segment check already makes an
 * escape impossible, and the walk holds each directory to its own checks as
 * well; this is the boundary written out on the value itself, so a reader — and
 * a scanner — can see where it is drawn without following the walk.
 */
export function resolveInside(
  root: string,
  segments: readonly string[],
): string | null {
  const resolved = resolve(root, ...segments);
  const fromRoot = relative(root, resolved);
  if (fromRoot !== "" && (fromRoot.startsWith("..") || isAbsolute(fromRoot)))
    return null;
  return resolved;
}

type Walked = { ok: true; path: string } | { ok: false; reason: Refusal };

/**
 * UNIT_BOUNDARY_DESCRIPTION: Every directory a call names before the last
 * segment, walked from the root and proved one component at a time. A component
 * that is missing, is a link, or whose path does not resolve to itself ends the
 * walk, so no later step ever sees a directory the root's guarantee did not
 * cover.
 */
export async function walkInRoot(
  root: string,
  segments: readonly string[],
  create: boolean,
): Promise<Walked> {
  if ((await realpath(root).catch(() => null)) !== root)
    return { ok: false, reason: "outside" };
  let current = root;
  for (const segment of segments) {
    const next = resolveInside(current, [segment]);
    if (next === null) return { ok: false, reason: "outside" };
    if ((await lstat(next).catch(() => null)) === null) {
      if (!create) return { ok: false, reason: "no-such-file" };
      if ((await mkdir(next, { mode: 0o700 }).catch(() => null)) === null)
        return { ok: false, reason: "not-writable" };
    }
    if (!(await realDirectory(next))) return { ok: false, reason: "outside" };
    current = next;
  }
  return { ok: true, path: current };
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: Runs one synchronous filesystem step with the
 * process inside a directory that was verified before, so the step names its
 * file relative to that directory's inode instead of by path. The directory is
 * proved again inside the step — its device and inode, and that its path still
 * resolves to it — because a rename followed by a symlink between the caller's
 * check and this move would otherwise steer it. Returns null when the directory
 * is no longer the one that was verified, before anything is written.
 */
function insideDirectory<T>(
  dir: string,
  proved: Proved,
  step: () => T,
): { ok: true; value: T } | { ok: false } {
  if (realpathSync(dir) !== dir) return { ok: false };
  const cwd = process.cwd();
  try {
    process.chdir(dir);
    const here = statSync(".");
    if (here.dev !== proved.dev || here.ino !== proved.ino)
      return { ok: false };
    if (realpathSync(dir) !== dir) return { ok: false };
    return { ok: true, value: step() };
  } catch {
    return { ok: false };
  } finally {
    process.chdir(cwd);
  }
}

export async function openInRoot(
  root: string,
  segments: readonly string[],
): Promise<Opened> {
  const parent = await walkInRoot(root, segments.slice(0, -1), false);
  const name = segments.at(-1);
  if (!parent.ok) return { ok: false, reason: parent.reason };
  if (name === undefined) return { ok: false, reason: "outside" };
  const path = resolveInside(parent.path, [name]);
  if (path === null) return { ok: false, reason: "outside" };
  let handle: FileHandle;
  try {
    handle = await open(
      path,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
  } catch (err) {
    return {
      ok: false,
      reason:
        (err as NodeJS.ErrnoException).code === "ENOENT"
          ? "no-such-file"
          : "not-a-file",
    };
  }
  const opened = await handle.stat().catch(() => null);
  if (opened === null || !(await sameFile(handle, path))) {
    await handle.close().catch(() => {});
    return { ok: false, reason: "not-a-file" };
  }
  return { ok: true, handle, size: opened.size };
}

export interface Facts {
  kind: FileKind;
  size: number | null;
  mtimeMs: number;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: What one entry is, read without following it: a
 * link is reported as a link, and only a regular file carries a size. The
 * parent directories are the ones the walk proved, so the last component is the
 * only thing read here.
 */
export async function lstatInRoot(
  root: string,
  segments: readonly string[],
): Promise<{ ok: true; facts: Facts } | { ok: false; reason: Refusal }> {
  const parent = await walkInRoot(root, segments.slice(0, -1), false);
  const name = segments.at(-1);
  if (!parent.ok) return parent;
  if (name === undefined) return { ok: false, reason: "outside" };
  const path = resolveInside(parent.path, [name]);
  if (path === null) return { ok: false, reason: "outside" };
  const info = await lstat(path).catch(() => null);
  if (info === null) return { ok: false, reason: "no-such-file" };
  const kind = kindOf(info);
  return {
    ok: true,
    facts: {
      kind,
      size: kind === "file" ? info.size : null,
      mtimeMs: info.mtimeMs,
    },
  };
}

export interface ListedEntry extends Facts {
  path: string;
}

export type ListCut = "limit" | "time" | null;

/**
 * UNIT_BOUNDARY_DESCRIPTION: A directory's entries, walked the same way a
 * transfer is: the root re-resolved, every directory on the way proved, and a
 * directory entered only after it was proved again, so a link is listed and
 * never descended into. A directory is iterated rather than read whole, so a
 * directory with more entries than the limit stops at the limit; the walk also
 * stops at the deadline, because on a network mount every `lstat` is remote.
 * Nested directories are visited in filesystem order, not sorted.
 *
 * The deadline and the signal are checked after every awaited filesystem call,
 * not only before one, so a call that comes back after the budget is a
 * truncation rather than a success. The ceiling is one stalled operation: a
 * filesystem call already in flight is not interrupted, so a listing can overrun
 * the budget by however long that single call takes to return.
 */
export async function listInRoot(
  root: string,
  segments: readonly string[],
  options: {
    depth: number;
    limit: number;
    deadline: number;
    matches: (entry: { path: string; kind: FileKind }) => boolean;
    signal?: AbortSignal;
  },
): Promise<
  | { ok: true; entries: ListedEntry[]; cut: ListCut }
  | { ok: false; reason: Refusal }
> {
  const entries: ListedEntry[] = [];
  let cut: ListCut = null;

  const stop = (): boolean => {
    if (options.signal?.aborted) throw new Error("cancelled");
    if (Date.now() > options.deadline) cut = "time";
    return cut !== null;
  };
  const stopped = (): { ok: true; entries: ListedEntry[]; cut: ListCut } => ({
    ok: true,
    entries,
    cut,
  });

  const resolved = await realpath(root).catch(() => null);
  if (stop()) return stopped();
  if (resolved !== root) return { ok: false, reason: "outside" };

  const parent =
    segments.length === 0
      ? ({ ok: true, path: root } as const)
      : await walkInRoot(root, segments.slice(0, -1), false);
  if (stop()) return stopped();
  if (!parent.ok) return parent;
  const name = segments.at(-1);
  const start = name === undefined ? root : resolveInside(parent.path, [name]);
  if (start === null) return { ok: false, reason: "outside" };

  const info = await lstat(start).catch(() => null);
  if (stop()) return stopped();
  if (info === null) return { ok: false, reason: "no-such-file" };
  if (!info.isDirectory()) {
    if (name === undefined) return { ok: false, reason: "outside" };
    const kind = kindOf(info);
    return {
      ok: true,
      entries: options.matches({ path: name, kind })
        ? [
            {
              path: name,
              kind,
              size: kind === "file" ? info.size : null,
              mtimeMs: info.mtimeMs,
            },
          ]
        : [],
      cut: null,
    };
  }

  const visit = async (
    handle: Dir,
    dir: string,
    prefix: string,
    depthLeft: number,
  ): Promise<void> => {
    for await (const entry of handle) {
      if (stop()) return;
      const path = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
      const child = join(dir, entry.name);
      const found = await lstat(child).catch(() => null);
      if (stop()) return;
      if (found === null) continue;
      const kind = kindOf(found);
      if (options.matches({ path, kind })) {
        entries.push({
          path,
          kind,
          size: kind === "file" ? found.size : null,
          mtimeMs: found.mtimeMs,
        });
        if (entries.length > options.limit) {
          cut = "limit";
          return;
        }
      }
      if (kind !== "dir" || depthLeft <= 1) continue;
      const proved = await realDirectory(child);
      if (stop()) return;
      if (!proved) continue;
      const nested = await opendir(child).catch(() => null);
      if (nested === null) continue;
      try {
        if (stop()) return;
        await visit(nested, child, path, depthLeft - 1);
      } finally {
        await nested.close().catch(() => {});
      }
      if (cut !== null) return;
    }
  };

  const proved = await realDirectory(start);
  if (stop()) return stopped();
  if (!proved) return { ok: false, reason: "outside" };
  const opened = await opendir(start).catch(() => null);
  try {
    if (stop()) return stopped();
    if (opened === null) return { ok: false, reason: "outside" };
    await visit(opened, start, "", options.depth);
    if (cut === null) stop();
  } finally {
    if (opened !== null) await opened.close().catch(() => {});
  }

  if (cut === "limit") entries.length = options.limit;
  return stopped();
}

export interface Staged {
  handle: FileHandle;
  path: string;
  target: string;
  dir: string;
  proved: Proved;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: A new file beside the one an upload will land as,
 * created exclusively and verified before anything is written, in a directory
 * that is proved and remembered so the publish can act inside it. A refused
 * destination leaves nothing behind and no byte is written outside the root.
 */
export async function stageInRoot(
  root: string,
  target: readonly string[],
): Promise<{ ok: true; staged: Staged } | { ok: false; reason: Refusal }> {
  const parent = await walkInRoot(root, target.slice(0, -1), true);
  const name = target.at(-1);
  if (!parent.ok) return { ok: false, reason: parent.reason };
  if (name === undefined) return { ok: false, reason: "outside" };
  const info = await lstat(parent.path).catch(() => null);
  if (info === null || !info.isDirectory() || info.isSymbolicLink())
    return { ok: false, reason: "outside" };

  const path = join(
    parent.path,
    `.${name}.incoming-${randomBytes(6).toString("hex")}`,
  );
  let handle: FileHandle;
  try {
    handle = await open(
      path,
      constants.O_RDWR |
        constants.O_CREAT |
        constants.O_EXCL |
        constants.O_NOFOLLOW,
      0o600,
    );
  } catch {
    return { ok: false, reason: "not-writable" };
  }
  if (!(await sameFile(handle, path))) {
    await handle.close().catch(() => {});
    await unlink(path).catch(() => {});
    return { ok: false, reason: "not-writable" };
  }
  return {
    ok: true,
    staged: {
      handle,
      path,
      target: join(parent.path, name),
      dir: parent.path,
      proved: { dev: info.dev, ino: info.ino },
    },
  };
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: Reads the staged file back through the descriptor
 * it was written on and reports its size and digest, or null when what is on
 * disk is not what was written — a short write, a truncated file, a file that is
 * no longer the one staged. A transfer that cannot prove its own file is not
 * published.
 */
export async function stagedDigest(staged: Staged): Promise<{
  size: number;
  sha256: string;
} | null> {
  try {
    await staged.handle.sync();
    const info = await staged.handle.stat();
    if (!info.isFile() || info.nlink !== 1) return null;
    const hash = createHash("sha256");
    const buffer = Buffer.allocUnsafe(64 * 1024);
    let read = 0;
    for (;;) {
      const { bytesRead } = await staged.handle.read(
        buffer,
        0,
        buffer.length,
        read,
      );
      if (bytesRead === 0) break;
      read += bytesRead;
      hash.update(buffer.subarray(0, bytesRead));
    }
    if (read !== info.size) return null;
    return { size: info.size, sha256: hash.digest("hex") };
  } catch {
    return null;
  }
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: Moves a staged file onto its name, once. Without
 * `overwrite` the name is taken by a hard link, which fails rather than
 * replacing anything; with it, a regular single-link file is replaced by renaming
 * over its directory entry, so a link someone else holds to the same inode keeps
 * its own content and a device or a FIFO is never written through. Both the
 * staged file and the published entry are proved to be the inode that was
 * staged, inside the directory that was proved when it was created.
 *
 * The staging name goes on every path: a rename consumes it, and a link leaves it
 * as a second name for the published file, so a leftover staging name would give
 * that file two links and the next transfer would refuse to touch it.
 */
export async function publishInRoot(
  root: string,
  staged: Staged,
  overwrite: boolean,
): Promise<Refusal | null> {
  const from = basename(staged.path);
  const to = basename(staged.target);
  const opened = await staged.handle.stat().catch(() => null);
  if (opened === null || !opened.isFile() || opened.nlink !== 1) {
    await discard(staged);
    return "changed";
  }
  if ((await realpath(root).catch(() => null)) !== root) {
    await discard(staged);
    return "outside";
  }

  const anchored = insideDirectory(staged.dir, staged.proved, () => {
    const current = lstatSync(from, { throwIfNoEntry: false });
    if (
      current === undefined ||
      current.isSymbolicLink() ||
      current.dev !== opened.dev ||
      current.ino !== opened.ino
    )
      return "changed" as const;

    const existing = lstatSync(to, { throwIfNoEntry: false });
    if (existing !== undefined) {
      if (!overwrite) return "exists" as const;
      if (
        !existing.isFile() ||
        existing.isSymbolicLink() ||
        existing.nlink !== 1
      )
        return "not-writable" as const;
      renameSync(from, to);
    } else {
      try {
        linkSync(from, to);
      } catch {
        return "exists" as const;
      }
    }

    const published = lstatSync(to, { throwIfNoEntry: false });
    if (
      published === undefined ||
      published.dev !== opened.dev ||
      published.ino !== opened.ino
    ) {
      rmSync(to, { force: true });
      rmSync(from, { force: true });
      return "changed" as const;
    }
    rmSync(from, { force: true });
    return "published" as const;
  });

  await staged.handle.close().catch(() => {});
  const outcome: Refusal | "published" = anchored.ok
    ? anchored.value
    : "outside";
  if (outcome === "published") return null;
  await unlink(staged.path).catch(() => {});
  return outcome;
}

async function discard(staged: Staged): Promise<void> {
  await staged.handle.close().catch(() => {});
  await unlink(staged.path).catch(() => {});
}
