import { constants } from "node:fs";
import type { FileHandle } from "node:fs/promises";
import {
  link,
  lstat,
  mkdir,
  open,
  realpath,
  rename,
  unlink,
} from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join, sep } from "node:path";
import { randomBytes } from "node:crypto";

/**
 * UNIT_BOUNDARY_DESCRIPTION: A file on the user's machine read or written
 * through one directory, without trusting a path component. The machine is the
 * user's own, but the caller is a prompt-injectable Agent, so a transfer must not
 * be steerable outside the root by a link that was already there or by one that
 * appears between two calls: every directory on the way is `lstat`ed and must be
 * real, a file is opened with `O_NOFOLLOW` and `O_NONBLOCK` (so a FIFO cannot
 * hang the worker), and the descriptor is then compared with the path it was
 * opened by — same device and inode, a regular file, one link. A write is
 * created exclusively, verified before a byte is written, and published by
 * replacing its own directory entry, never by writing through a link.
 *
 * The ceiling: Node cannot make the check and the open one operation, so a
 * process already running as this user can still race the final comparison.
 * Closing that needs `openat2(RESOLVE_BENEATH)`, which Node does not expose.
 */

export const MAX_TRANSFER_BYTES = 50 * 1024 * 1024;

export function platformRefusal(): string | null {
  return process.platform === "win32"
    ? "a files satellite needs a POSIX machine — this build cannot confine a path on Windows"
    : null;
}

export type Refusal =
  | "outside"
  | "not-a-file"
  | "too-large"
  | "exists"
  | "no-such-file"
  | "not-writable";

export type Opened =
  | { ok: true; handle: FileHandle; size: number }
  | { ok: false; reason: Refusal };

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

async function sameFile(handle: FileHandle, path: string): Promise<boolean> {
  const opened = await handle.stat();
  if (!opened.isFile() || opened.nlink !== 1) return false;
  const real = await realpath(path).catch(() => null);
  if (real !== path) return false;
  const entry = await lstat(path).catch(() => null);
  return entry !== null && entry.dev === opened.dev && entry.ino === opened.ino;
}

async function realDirectory(path: string): Promise<boolean> {
  const entry = await lstat(path).catch(() => null);
  if (entry === null || !entry.isDirectory() || entry.isSymbolicLink())
    return false;
  return (await realpath(path).catch(() => null)) === path;
}

async function walk(
  root: string,
  segments: readonly string[],
  create: boolean,
): Promise<string | null> {
  if ((await realpath(root).catch(() => null)) !== root) return null;
  let current = root;
  for (const segment of segments) {
    const next = join(current, segment);
    if ((await lstat(next).catch(() => null)) === null) {
      if (
        !create ||
        (await mkdir(next, { mode: 0o700 }).catch(() => null)) === null
      )
        return null;
    }
    if (!(await realDirectory(next))) return null;
    current = next;
  }
  return current;
}

export async function openInRoot(
  root: string,
  segments: readonly string[],
  cap: number,
): Promise<Opened> {
  const parent = await walk(root, segments.slice(0, -1), false);
  const name = segments.at(-1);
  if (parent === null || name === undefined)
    return { ok: false, reason: "outside" };
  const path = join(parent, name);
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
  if (opened.size > cap) {
    await handle.close().catch(() => {});
    return { ok: false, reason: "too-large" };
  }
  return { ok: true, handle, size: opened.size };
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: A new file beside the one an upload will land as,
 * created exclusively and verified before anything is written, so a refused
 * destination leaves nothing behind and no byte is ever written outside the
 * root.
 */
export async function stageInRoot(
  root: string,
  target: readonly string[],
): Promise<
  | { ok: true; handle: FileHandle; path: string; target: string }
  | { ok: false; reason: Refusal }
> {
  const parent = await walk(root, target.slice(0, -1), true);
  const name = target.at(-1);
  if (parent === null || name === undefined)
    return { ok: false, reason: "outside" };

  const path = join(
    parent,
    `.${name}.incoming-${randomBytes(6).toString("hex")}`,
  );
  let handle: FileHandle;
  try {
    handle = await open(
      path,
      constants.O_WRONLY |
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
  return { ok: true, handle, path, target: join(parent, name) };
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: Moves a staged file onto its name. Without
 * `overwrite` the name is taken by a hard link, which fails rather than
 * replacing anything; with it, a regular single-link file is replaced by
 * renaming over its directory entry, so a link someone else holds to the same
 * inode keeps its own content and a device or a FIFO is never written through.
 */
export async function publishInRoot(
  root: string,
  staged: { handle: FileHandle; path: string; target: string },
  overwrite: boolean,
): Promise<Refusal | null> {
  await staged.handle.close().catch(() => {});
  const parent = await realpath(join(staged.target, "..")).catch(() => null);
  if (
    parent === null ||
    (parent !== root && !parent.startsWith(root + sep)) ||
    (await realpath(root).catch(() => null)) !== root
  ) {
    await unlink(staged.path).catch(() => {});
    return "outside";
  }
  const existing = await lstat(staged.target).catch(() => null);
  if (existing !== null) {
    if (!overwrite) {
      await unlink(staged.path).catch(() => {});
      return "exists";
    }
    if (
      !existing.isFile() ||
      existing.isSymbolicLink() ||
      existing.nlink !== 1
    ) {
      await unlink(staged.path).catch(() => {});
      return "not-writable";
    }
    if (
      await rename(staged.path, staged.target)
        .then(() => false)
        .catch(() => true)
    ) {
      return "not-writable";
    }
    return null;
  }
  const linked = await link(staged.path, staged.target)
    .then(() => true)
    .catch(() => false);
  if (!linked) {
    await unlink(staged.path).catch(() => {});
    return "not-writable";
  }
  await unlink(staged.path).catch(() => {});
  return null;
}
