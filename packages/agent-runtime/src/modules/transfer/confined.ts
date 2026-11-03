import { createHash, randomBytes } from "node:crypto";
import { constants } from "node:fs";
import {
  linkSync,
  lstatSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
} from "node:fs";
import type { FileHandle } from "node:fs/promises";
import {
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
 * the components itself: each directory is `lstat`ed and must be real, the file
 * is opened with `O_NOFOLLOW` (and `O_NONBLOCK`, so a FIFO cannot hang the
 * caller), and the descriptor is then checked against the path it was opened
 * by — same device and inode, a regular file, one link.
 *
 * A received file is staged under a random name in the directory it will be
 * published into, and published by one synchronous step taken *inside* that
 * directory: the process moves into the directory's inode, proves it is still
 * the one that was checked, and names both files relatively. Renaming a path on
 * top of that cannot redirect the step — the guarantee `linkat`/`renameat` give,
 * which Node does not expose. The staged file and the published entry are both
 * proved to be the same inode before the transfer counts as written, and the
 * bytes on disk are read back and compared with what was hashed before it is.
 */

export const MAX_TRANSFER_BYTES = 50 * 1024 * 1024;

export const TRANSFER_ROOT = [".dam", "satellite-files"];

export const STAGING_PREFIX = ".incoming-";

const STAGING_ID = /^[0-9a-f]{32}$/;

export type Refusal = "refused" | "not-found" | "too-large" | "exists";

interface Proved {
  dev: number;
  ino: number;
}

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

export interface Staged {
  id: string;
  handle: FileHandle;
  name: string;
  dir: string;
  proved: Proved;
  destination: string;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: A new file, under a random name, in the directory
 * the transfer will publish into. The directory chain is created one component
 * at a time, the file is created exclusively, and the descriptor is verified
 * before any byte is written — so a refused path leaves nothing behind and no
 * content ever lands outside the workspace. The directory is remembered by
 * device and inode for the publish, which acts inside it.
 */
export async function createStaged(
  root: string,
  destination: readonly string[],
): Promise<{ ok: true; staged: Staged } | { ok: false; reason: Refusal }> {
  const dir = await walk(root, destination.slice(0, -1), true);
  const name = destination.at(-1);
  if (dir === null || name === undefined)
    return { ok: false, reason: "refused" };
  const info = await lstat(dir).catch(() => null);
  if (info === null || !info.isDirectory() || info.isSymbolicLink())
    return { ok: false, reason: "refused" };

  const id = randomBytes(16).toString("hex");
  const stagedName = `${STAGING_PREFIX}${id}`;
  const path = join(dir, stagedName);
  const attempt = await openOrCode(
    path,
    constants.O_RDWR |
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
  return {
    ok: true,
    staged: {
      id,
      handle,
      name: stagedName,
      dir,
      proved: { dev: info.dev, ino: info.ino },
      destination: join(dir, name),
    },
  };
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: Reopens the staged file a stage request left
 * behind, so the publish can act inside the directory that was proved then. The
 * name is the id the stage answered with, and the descriptor is proved to be a
 * regular single-link file inside that directory before anything is published.
 */
export async function openStaged(
  root: string,
  destination: readonly string[],
  id: string,
): Promise<Staged | null> {
  const dir = await walk(root, destination.slice(0, -1), false);
  const name = destination.at(-1);
  if (dir === null || name === undefined) return null;
  const info = await lstat(dir).catch(() => null);
  if (info === null || !info.isDirectory() || info.isSymbolicLink())
    return null;

  const stagedName = `${STAGING_PREFIX}${id}`;
  const path = join(dir, stagedName);
  const attempt = await openOrCode(
    path,
    constants.O_RDWR | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  );
  if ("code" in attempt) return null;
  if (!(await sameFile(attempt.handle, path))) {
    await attempt.handle.close().catch(() => {});
    return null;
  }
  return {
    id,
    handle: attempt.handle,
    name: stagedName,
    dir,
    proved: { dev: info.dev, ino: info.ino },
    destination: join(dir, name),
  };
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: Reads a staged file back through the descriptor it
 * was written on and reports its digest, or null when what is on disk is not
 * what was written. A transfer that cannot prove its own file is not published.
 */
export async function stagedDigest(
  staged: Staged,
): Promise<{ size: number; sha256: string } | null> {
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
 * UNIT_BOUNDARY_DESCRIPTION: Publishes a staged file at its destination, once.
 * The staged file is proved to be the inode that was written, the destination
 * directory to be the one the staging created, and the landing entry to be that
 * same inode; the landing entry is created with a hard link, which fails when
 * the name is taken, and the staging name removed. So a transfer never replaces
 * a file the Agent already had, and an Agent cannot make the platform publish
 * outside its workspace.
 */
export async function publishStaged(
  root: string,
  staged: Staged,
): Promise<{ ok: true; path: string } | { ok: false; reason: Refusal }> {
  const opened = await staged.handle.stat().catch(() => null);
  if (opened === null || !opened.isFile() || opened.nlink !== 1) {
    await discardStaged(staged);
    return { ok: false, reason: "refused" };
  }
  if ((await realpath(root).catch(() => null)) !== root) {
    await discardStaged(staged);
    return { ok: false, reason: "refused" };
  }

  const name = staged.destination.slice(staged.dir.length + 1);
  const anchored = insideDirectory(staged.dir, staged.proved, () => {
    const current = lstatSync(staged.name, { throwIfNoEntry: false });
    if (
      current === undefined ||
      current.isSymbolicLink() ||
      current.dev !== opened.dev ||
      current.ino !== opened.ino
    )
      return "refused" as const;
    if (lstatSync(name, { throwIfNoEntry: false }) !== undefined)
      return "exists" as const;
    try {
      linkSync(staged.name, name);
    } catch {
      return "exists" as const;
    }
    const published = lstatSync(name, { throwIfNoEntry: false });
    if (
      published === undefined ||
      published.dev !== opened.dev ||
      published.ino !== opened.ino
    ) {
      rmSync(name, { force: true });
      return "refused" as const;
    }
    rmSync(staged.name, { force: true });
    return "published" as const;
  });

  await staged.handle.close().catch(() => {});
  const outcome: Refusal | "published" = anchored.ok
    ? anchored.value
    : "refused";
  if (outcome === "published") return { ok: true, path: staged.destination };
  await unlink(join(staged.dir, staged.name)).catch(() => {});
  return { ok: false, reason: outcome };
}

export async function discardStaged(staged: Staged): Promise<void> {
  await staged.handle.close().catch(() => {});
  await unlink(join(staged.dir, staged.name)).catch(() => {});
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: Removes staged transfers whose publisher never
 * came back — a platform replica that died between staging a body and
 * publishing it. Each claim directory is walked as any other path is, and only
 * an entry that is our own staging name, a regular single-link file and older
 * than the cutoff is removed, inside that directory's inode. Cleaning up is how
 * an abandoned stage stops costing disk, and it must not become a way to delete
 * a file outside the workspace.
 */
export async function sweepStaging(
  root: string,
  olderThanMs: number,
): Promise<void> {
  const transferRoot = await walk(root, TRANSFER_ROOT, false).catch(() => null);
  if (transferRoot === null) return;
  const claimDirs = await readdir(transferRoot).catch(() => []);
  const cutoff = Date.now() - olderThanMs;
  for (const claimDir of claimDirs) {
    const dir = join(transferRoot, claimDir);
    const info = await lstat(dir).catch(() => null);
    if (info === null || !info.isDirectory() || info.isSymbolicLink()) continue;
    const proved = { dev: info.dev, ino: info.ino };
    insideDirectory(dir, proved, () => {
      for (const entry of readdirSync(dir)) {
        if (!entry.startsWith(STAGING_PREFIX)) continue;
        if (!STAGING_ID.test(entry.slice(STAGING_PREFIX.length))) continue;
        const staged = lstatSync(entry, { throwIfNoEntry: false });
        if (staged === undefined || !staged.isFile() || staged.nlink !== 1)
          continue;
        if (staged.mtimeMs > cutoff) continue;
        rmSync(entry, { force: true });
      }
    });
  }
}
