import { constants } from "node:fs";
import type { FileHandle } from "node:fs/promises";
import {
  link,
  lstat,
  mkdir,
  open,
  readdir,
  realpath,
  unlink,
} from "node:fs/promises";
import { join } from "node:path";

/**
 * UNIT_BOUNDARY_DESCRIPTION: A file the platform moves through an Agent's
 * workspace, opened without trusting a single path component. An Agent owns
 * everything inside its own workspace, symlinks included, so a transfer walks
 * the components itself: each directory is `lstat`ed and must be a real one,
 * the file is opened with `O_NOFOLLOW` (and `O_NONBLOCK`, so a FIFO cannot hang
 * the caller), and the descriptor is then checked against the path it was opened
 * by — same device and inode, a regular file, one link. A symlink planted
 * before the open is refused by `O_NOFOLLOW`; one planted in a parent between
 * the check and the open is caught by the post-open comparison, because the
 * opened file is then not the file the path names.
 *
 * The ceiling: two Node calls cannot be made one, so a workspace that is being
 * written to by an Agent at the same moment as the platform reads it can still
 * race the last comparison. Closing that needs `openat2(RESOLVE_BENEATH)`, which
 * Node does not expose.
 */

export const MAX_TRANSFER_BYTES = 50 * 1024 * 1024;

export const TRANSFER_STAGING_DIR = [".dam", "satellite-files", ".incoming"];

export type Refusal = "refused" | "not-found" | "too-large" | "exists";

export type ConfinedFile =
  | { ok: true; handle: FileHandle; size: number }
  | { ok: false; reason: Refusal };

/**
 * UNIT_BOUNDARY_DESCRIPTION: A workspace path as segments, or null when it
 * cannot name anything the transfer may touch: empty, absolute, longer than the
 * cap, carrying a NUL or a `..`, or holding a segment this workspace reserves.
 */
export function workspaceSegments(
  relative: string,
  reserved: readonly string[],
): string[] | null {
  if (relative === "" || relative.length > 1024) return null;
  if (relative.includes("\0")) return null;
  if (relative.startsWith("/")) return null;
  const segments = relative.split("/");
  if (segments.some((s) => s === "" || s === "." || s === "..")) return null;
  if (segments.some((s) => reserved.includes(s))) return null;
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

async function openOrCode(
  path: string,
  flags: number,
  mode?: number,
): Promise<{ handle: FileHandle } | { code: string }> {
  try {
    return { handle: await open(path, flags, mode) };
  } catch (err) {
    return { code: (err as NodeJS.ErrnoException).code ?? "EIO" };
  }
}

async function realDirectory(path: string): Promise<boolean> {
  const entry = await lstat(path).catch(() => null);
  if (entry === null || !entry.isDirectory() || entry.isSymbolicLink())
    return false;
  const real = await realpath(path).catch(() => null);
  return real === path;
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
    const exists = await lstat(next).catch(() => null);
    if (exists === null) {
      if (!create || (await mkdir(next).catch(() => null)) === null)
        return null;
    }
    if (!(await realDirectory(next))) return null;
    current = next;
  }
  return current;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: Opens one existing workspace file for reading,
 * refusing anything that is not a plain single-link regular file inside the
 * workspace, and refusing it before a byte is read.
 */
export async function openConfined(
  root: string,
  segments: readonly string[],
  cap: number,
): Promise<ConfinedFile> {
  const parent = await walk(root, segments.slice(0, -1), false);
  const name = segments.at(-1);
  if (parent === null || name === undefined)
    return { ok: false, reason: "refused" };
  const path = join(parent, name);
  const attempt = await openOrCode(
    path,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  );
  if ("code" in attempt)
    return {
      ok: false,
      reason: attempt.code === "ENOENT" ? "not-found" : "refused",
    };
  const handle = attempt.handle;
  const opened = await handle.stat().catch(() => null);
  if (opened === null || !(await sameFile(handle, path))) {
    await handle.close().catch(() => {});
    return { ok: false, reason: "refused" };
  }
  if (opened.size > cap) {
    await handle.close().catch(() => {});
    return { ok: false, reason: "too-large" };
  }
  return { ok: true, handle, size: opened.size };
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: Creates the one file a transfer will publish, and
 * nothing else: the directory chain under `staging` is created one component at
 * a time, the file is created exclusively, and the descriptor is verified before
 * any byte is written, so a refused path leaves nothing behind and no content
 * ever lands outside the workspace.
 */
export async function createConfined(
  root: string,
  dirs: readonly string[],
  name: string,
): Promise<ConfinedFile> {
  const parent = await walk(root, dirs, true);
  if (parent === null) return { ok: false, reason: "refused" };
  const path = join(parent, name);
  const attempt = await openOrCode(
    path,
    constants.O_WRONLY |
      constants.O_CREAT |
      constants.O_EXCL |
      constants.O_NOFOLLOW,
    0o600,
  );
  if ("code" in attempt)
    return {
      ok: false,
      reason: attempt.code === "EEXIST" ? "exists" : "refused",
    };
  const handle = attempt.handle;
  if (!(await sameFile(handle, path))) {
    await handle.close().catch(() => {});
    await unlink(path).catch(() => {});
    return { ok: false, reason: "refused" };
  }
  return { ok: true, handle, size: 0 };
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: Publishes a staged file at its destination, once.
 * The staged file is verified the same way a read is, the destination directory
 * is verified again, and the landing entry is created with a hard link — which
 * fails when the name is taken — and the staging name then removed. So a
 * transfer never replaces a file the Agent already had, and an Agent cannot make
 * the platform publish outside its workspace.
 */
export async function publishConfined(
  root: string,
  staging: readonly string[],
  destination: readonly string[],
  cap: number,
): Promise<{ ok: true; path: string } | { ok: false; reason: Refusal }> {
  const staged = await openConfined(root, staging, cap);
  if (!staged.ok) return staged;
  await staged.handle.close().catch(() => {});

  const parent = await walk(root, destination.slice(0, -1), true);
  const name = destination.at(-1);
  if (parent === null || name === undefined)
    return { ok: false, reason: "refused" };
  const path = join(parent, name);
  if ((await lstat(path).catch(() => null)) !== null)
    return { ok: false, reason: "exists" };

  const stagingPath = join(root, ...staging);
  const linked = await link(stagingPath, path)
    .then(() => true)
    .catch((err: NodeJS.ErrnoException) => err.code);
  if (linked !== true)
    return { ok: false, reason: linked === "EEXIST" ? "exists" : "refused" };
  await unlink(stagingPath).catch(() => {});
  return { ok: true, path };
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: Removes staged transfers whose publisher never
 * came back — a platform replica that died between staging a body and
 * publishing it. They are named by a random id and never read by anyone, so
 * dropping them by age is the whole of their lifetime.
 */
export async function sweepStaging(
  root: string,
  olderThanMs: number,
): Promise<void> {
  const dir = join(root, ...TRANSFER_STAGING_DIR);
  const entries = await readdir(dir).catch(() => []);
  const now = Date.now();
  for (const entry of entries) {
    const info = await lstat(join(dir, entry)).catch(() => null);
    if (info === null || now - info.mtimeMs < olderThanMs) continue;
    await unlink(join(dir, entry)).catch(() => {});
  }
}
