import { createHash } from "node:crypto";
import { constants, readFileSync, rmSync } from "node:fs";
import type { Stats } from "node:fs";
import {
  closeSync,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  renameSync,
  rmdirSync,
  statSync,
  symlinkSync,
  unlinkSync,
} from "node:fs";
import type { FileHandle } from "node:fs/promises";
import {
  lstat,
  mkdir,
  open,
  readFile,
  readlink,
  realpath,
  rm,
  statfs,
  writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import {
  SATELLITE_FILE_MAX_READDIR,
  satelliteFileOpMutates,
  satelliteFileOpSchema,
  type SatelliteFileErrno,
} from "api-server-api";
import {
  insideDirectory,
  kindOf,
  pathSegments,
  resolveInside,
  walkInRoot,
  type FileKind,
  type Proved,
} from "./confined-files.js";

export const FREE_HEADROOM_BYTES = 1 << 30;

const LOCK_DIRECTORY = "satellite-files";

export type FileAttrs = {
  kind: FileKind;
  size: number;
  mtimeMs: number;
  ctimeMs: number;
  atimeMs: number;
  mode: number;
  dev: number;
  ino: number;
};

export type FileOpAnswer =
  | { ok: true; result?: unknown; data?: string }
  | { ok: false; errno: SatelliteFileErrno };

export type FileOpRequest = {
  op: string;
  path?: string;
  args?: Record<string, unknown>;
  data?: string;
  deadline: number;
};

type Refused = { ok: false; errno: SatelliteFileErrno };
type Found = { ok: true; path: string; info: Stats };

const ERRNO_BY_CODE: Record<string, SatelliteFileErrno> = {
  EACCES: "EACCES",
  EBUSY: "EBUSY",
  EEXIST: "EEXIST",
  EINVAL: "EINVAL",
  EISDIR: "EISDIR",
  ELOOP: "EPERM",
  ENAMETOOLONG: "ENAMETOOLONG",
  ENODEV: "EPERM",
  ENOENT: "ENOENT",
  ENOSPC: "ENOSPC",
  ENOTDIR: "ENOTDIR",
  ENOTEMPTY: "ENOTEMPTY",
  ENOTSUP: "ENOTSUP",
  ENXIO: "EPERM",
  EPERM: "EPERM",
  EROFS: "EROFS",
  ESTALE: "ESTALE",
  EXDEV: "EXDEV",
};

function errnoOf(err: unknown): SatelliteFileErrno {
  const code = (err as { code?: unknown } | null)?.code;
  return (typeof code === "string" ? ERRNO_BY_CODE[code] : undefined) ?? "EIO";
}

const VERIFY_FLAGS = constants.O_NOFOLLOW | constants.O_NONBLOCK;

const WRITE_FLAGS = constants.O_WRONLY | VERIFY_FLAGS;
const READ_FLAGS = constants.O_RDONLY | VERIFY_FLAGS;
const DIRECTORY_FLAGS =
  constants.O_RDONLY | VERIFY_FLAGS | constants.O_DIRECTORY;

function attrsOf(info: Stats): FileAttrs {
  return {
    kind: kindOf(info),
    size: info.size,
    mtimeMs: info.mtimeMs,
    ctimeMs: info.ctimeMs,
    atimeMs: info.atimeMs,
    mode: info.mode & 0o777,
    dev: info.dev,
    ino: info.ino,
  };
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: A symbolic link's target is shown and created only
 * when it stays inside the Satellite's root: relative, zero or more leading `..`
 * and then plain names, with no more `..` than the link's own directory lies
 * below the root. The mount answers the same rule before the platform is asked,
 * and the worker answers it again because the Agent may call the channel
 * directly.
 */
export function targetStaysInside(target: string, depth: number): boolean {
  if (target === "") return false;
  let climbing = true;
  let up = 0;
  for (const part of target.split("/")) {
    if (part === "" || part === "." || part.includes("\0")) return false;
    if (part === "..") {
      if (!climbing) return false;
      up += 1;
      if (up > depth) return false;
    } else climbing = false;
  }
  return true;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: The machine's half of a Satellite Mount: every
 * operation an Agent's tools make under `/mnt/sat/<name>`, done against the one
 * directory the user named. The caller is prompt-injectable and may call the file
 * channel itself, so nothing here trusts a path: a path is relative segments or
 * `.` for the root, the root is resolved again on every operation, every
 * directory on the way is proved real, and no step follows a link.
 *
 * The ceilings, stated: Node has no `openat`/`renameat`, so a step inside a
 * directory makes it the process's working directory and tree changes run one at
 * a time (one worker per root is enforced); a rename is proved in the source
 * parent and the target parent is re-proved in the same step, while a same-user
 * process can still win that race, which `openat2`/`renameat2` would close. The
 * link rule is checked on the link itself, so a compliant link can pass through a
 * link the user made that leaves the root.
 */
export function createFileOps(deps: {
  root: string;
  writable: boolean;
  freeBytes?: (path: string) => Promise<number>;
}) {
  const freeBytes =
    deps.freeBytes ??
    (async (at: string): Promise<number> => {
      const info = await statfs(at);
      return info.bavail * info.bsize;
    });

  async function rootNow(): Promise<{ ok: true; root: string } | Refused> {
    const at = await realpath(deps.root).catch(() => null);
    if (at === deps.root) return { ok: true, root: at };
    const present = await lstat(deps.root).catch(() => null);
    return { ok: false, errno: present === null ? "ENOENT" : "EACCES" };
  }

  function segmentsOf(raw: string | undefined): string[] | null {
    if (raw === ".") return [];
    return pathSegments(raw);
  }

  async function entryOf(
    root: string,
    segments: readonly string[],
  ): Promise<Found | Refused> {
    const name = segments.at(-1);
    if (name === undefined) {
      const info = await lstat(root).catch(() => null);
      return info === null
        ? { ok: false, errno: "ENOENT" }
        : { ok: true, path: root, info };
    }
    const parent = await walkInRoot(root, segments.slice(0, -1));
    if (!parent.ok)
      return {
        ok: false,
        errno: parent.reason === "no-such-file" ? "ENOENT" : "EACCES",
      };
    const path = resolveInside(parent.path, [name]);
    if (path === null) return { ok: false, errno: "EACCES" };
    const info = await lstat(path).catch(() => null);
    return info === null
      ? { ok: false, errno: "ENOENT" }
      : { ok: true, path, info };
  }

  async function parentOf(
    root: string,
    segments: readonly string[],
  ): Promise<{ ok: true; path: string; proved: Proved } | Refused> {
    const walked = await walkInRoot(root, segments.slice(0, -1));
    if (!walked.ok)
      return {
        ok: false,
        errno: walked.reason === "no-such-file" ? "ENOENT" : "EACCES",
      };
    const info = await lstat(walked.path).catch(() => null);
    if (info === null) return { ok: false, errno: "ENOENT" };
    return {
      ok: true,
      path: walked.path,
      proved: { dev: info.dev, ino: info.ino },
    };
  }

  async function openHandle(
    path: string,
    intent: "read" | "write" | "chmod",
    directory: boolean,
  ): Promise<{ ok: true; handle: FileHandle } | Refused> {
    const attempts = directory
      ? [DIRECTORY_FLAGS]
      : intent === "read"
        ? [READ_FLAGS]
        : intent === "write"
          ? [WRITE_FLAGS]
          : [constants.O_RDWR | VERIFY_FLAGS, READ_FLAGS, WRITE_FLAGS];
    let refused: SatelliteFileErrno = "EACCES";
    for (const flags of attempts)
      try {
        return { ok: true, handle: await open(path, flags) };
      } catch (err) {
        refused = errnoOf(err);
      }
    return { ok: false, errno: refused };
  }

  /**
   * UNIT_BOUNDARY_DESCRIPTION: A handle on the entry a path names, proved before
   * anything acts on it. The entry is read first and a link, a FIFO, a socket or a
   * device is refused there, so a special file is never opened at all — opening a
   * device can have side effects, and opening a FIFO can block. A directory is
   * opened only for an attribute change; content operations take a regular file
   * with exactly one link. The descriptor is then compared with the entry and with
   * the identity the Agent saw, so an entry swapped between the check and the open,
   * or a stale identity, answers ESTALE rather than touching the wrong inode.
   */
  async function openVerified(
    root: string,
    segments: readonly string[],
    intent: "read" | "write" | "chmod",
    expected: { dev?: number; ino?: number },
  ): Promise<
    | {
        ok: true;
        handle: FileHandle;
        path: string;
        info: Stats;
        directory: boolean;
      }
    | Refused
  > {
    const parent = await parentOf(root, segments);
    if (!parent.ok) return parent;
    const name = segments.at(-1);
    if (name === undefined) return { ok: false, errno: "EISDIR" };
    const path = resolveInside(parent.path, [name]);
    if (path === null) return { ok: false, errno: "EACCES" };

    const entry = await lstat(path).catch(() => null);
    if (entry === null) return { ok: false, errno: "ENOENT" };
    if (entry.isSymbolicLink()) return { ok: false, errno: "EPERM" };
    const directory = entry.isDirectory();
    if (directory && intent !== "chmod") return { ok: false, errno: "EISDIR" };
    if (!directory && !entry.isFile()) return { ok: false, errno: "EPERM" };

    const opened = await openHandle(path, intent, directory);
    if (!opened.ok) return opened;
    const { handle } = opened;
    const info = await handle.stat().catch(() => null);
    let refused: SatelliteFileErrno | null = null;
    if (info === null) refused = "EIO";
    else if (info.dev !== entry.dev || info.ino !== entry.ino)
      refused = "ESTALE";
    else if (directory && !info.isDirectory()) refused = "ESTALE";
    else if (!directory && (!info.isFile() || info.nlink !== 1))
      refused = "EPERM";
    else if (!directory && (await realpath(path).catch(() => null)) !== path)
      refused = "ESTALE";
    else if (expected.dev !== undefined && expected.dev !== info.dev)
      refused = "ESTALE";
    else if (expected.ino !== undefined && expected.ino !== info.ino)
      refused = "ESTALE";
    if (refused !== null) {
      await handle.close().catch(() => {});
      return { ok: false, errno: refused };
    }
    return { ok: true, handle, path, info: info!, directory };
  }

  async function step(
    dir: string,
    proved: Proved,
    run: () => FileOpAnswer,
  ): Promise<FileOpAnswer> {
    const done = insideDirectory(dir, proved, (): FileOpAnswer => {
      try {
        return run();
      } catch (err) {
        return { ok: false, errno: errnoOf(err) };
      }
    });
    return done.ok ? done.value : { ok: false, errno: "EACCES" };
  }

  async function getattrOp(
    root: string,
    segments: readonly string[],
  ): Promise<FileOpAnswer> {
    const entry = await entryOf(root, segments);
    if (!entry.ok) return entry;
    return { ok: true, result: attrsOf(entry.info) };
  }

  async function lookupOp(
    root: string,
    segments: readonly string[],
    parentDev: number | undefined,
    parentIno: number | undefined,
  ): Promise<FileOpAnswer> {
    const entry = await entryOf(root, segments);
    if (!entry.ok) return entry;
    if (parentDev === undefined && parentIno === undefined)
      return getattrOp(root, segments);
    const parent = await entryOf(root, segments.slice(0, -1));
    if (!parent.ok) return parent;
    if (parentDev !== undefined && parent.info.dev !== parentDev)
      return { ok: false, errno: "ESTALE" };
    if (parentIno !== undefined && parent.info.ino !== parentIno)
      return { ok: false, errno: "ESTALE" };
    return { ok: true, result: attrsOf(entry.info) };
  }

  /**
   * UNIT_BOUNDARY_DESCRIPTION: A page of the directory a path names, taken inside
   * the directory itself. The parent is proved by the walk, the entry is proved a
   * real directory inside that parent's own inode, and the process steps into it
   * before a single name is read, so a directory swapped for a link after the walk
   * is refused instead of listed. Names come in filesystem order with their
   * attributes, never descending into a link, and the page's `next` is the offset
   * plus what it returned.
   */
  async function readdirOp(
    root: string,
    segments: readonly string[],
    offset: number,
    limit: number,
  ): Promise<FileOpAnswer> {
    const window = Math.min(limit, SATELLITE_FILE_MAX_READDIR);
    const page = (): FileOpAnswer => {
      const entries: (FileAttrs & { name: string })[] = [];
      let seen = 0;
      for (const name of readdirSync(".")) {
        if (seen++ < offset) continue;
        if (entries.length >= window) break;
        const info = lstatSync(name, { throwIfNoEntry: false });
        if (info === undefined) continue;
        entries.push({ name, ...attrsOf(info) });
      }
      return { ok: true, result: { entries, next: offset + entries.length } };
    };

    if (segments.length === 0) {
      const info = await lstat(root).catch(() => null);
      if (info === null) return { ok: false, errno: "ENOENT" };
      return step(root, { dev: info.dev, ino: info.ino }, page);
    }

    const parent = await parentOf(root, segments);
    if (!parent.ok) return parent;
    const name = segments.at(-1)!;
    return step(parent.path, parent.proved, () => {
      const child = lstatSync(name, { throwIfNoEntry: false });
      if (child === undefined) return { ok: false, errno: "ENOENT" };
      if (child.isSymbolicLink()) return { ok: false, errno: "EACCES" };
      if (!child.isDirectory()) return { ok: false, errno: "ENOTDIR" };
      process.chdir(name);
      const here = statSync(".");
      if (here.dev !== child.dev || here.ino !== child.ino)
        return { ok: false, errno: "ESTALE" };
      return page();
    });
  }

  async function readOp(
    root: string,
    segments: readonly string[],
    offset: number,
    size: number,
    dev: number,
    ino: number,
  ): Promise<FileOpAnswer> {
    const opened = await openVerified(root, segments, "read", { dev, ino });
    if (!opened.ok) return opened;
    try {
      const buffer = Buffer.allocUnsafe(size);
      const { bytesRead } = await opened.handle.read(buffer, 0, size, offset);
      return {
        ok: true,
        data: buffer.subarray(0, bytesRead).toString("base64"),
      };
    } catch (err) {
      return { ok: false, errno: errnoOf(err) };
    } finally {
      await opened.handle.close().catch(() => {});
    }
  }

  async function openOp(
    root: string,
    segments: readonly string[],
    write: boolean,
    dev: number | undefined,
    ino: number | undefined,
  ): Promise<FileOpAnswer> {
    const opened = await openVerified(
      root,
      segments,
      write ? "write" : "read",
      { dev, ino },
    );
    if (!opened.ok) return opened;
    await opened.handle.close().catch(() => {});
    return { ok: true, result: { ...attrsOf(opened.info), writable: write } };
  }

  async function writeOp(
    root: string,
    segments: readonly string[],
    offset: number,
    bytes: Buffer,
    dev: number,
    ino: number,
  ): Promise<FileOpAnswer> {
    const opened = await openVerified(root, segments, "write", {
      dev,
      ino,
    });
    if (!opened.ok) return opened;
    try {
      const free = await freeBytes(opened.path).catch(() => null);
      if (free !== null && free - bytes.length < FREE_HEADROOM_BYTES)
        return { ok: false, errno: "ENOSPC" };
      let written = 0;
      while (written < bytes.length) {
        const { bytesWritten } = await opened.handle.write(
          bytes,
          written,
          bytes.length - written,
          offset + written,
        );
        if (bytesWritten <= 0) return { ok: false, errno: "EIO" };
        written += bytesWritten;
      }
      return { ok: true, result: attrsOf(await opened.handle.stat()) };
    } catch (err) {
      return { ok: false, errno: errnoOf(err) };
    } finally {
      await opened.handle.close().catch(() => {});
    }
  }

  async function truncateOp(
    root: string,
    segments: readonly string[],
    size: number,
    dev: number,
    ino: number,
  ): Promise<FileOpAnswer> {
    const opened = await openVerified(root, segments, "write", {
      dev,
      ino,
    });
    if (!opened.ok) return opened;
    try {
      if (size > opened.info.size) {
        const free = await freeBytes(opened.path).catch(() => null);
        if (
          free !== null &&
          free - (size - opened.info.size) < FREE_HEADROOM_BYTES
        )
          return { ok: false, errno: "ENOSPC" };
      }
      await opened.handle.truncate(size);
      return { ok: true, result: attrsOf(await opened.handle.stat()) };
    } catch (err) {
      return { ok: false, errno: errnoOf(err) };
    } finally {
      await opened.handle.close().catch(() => {});
    }
  }

  async function setattrOp(
    root: string,
    segments: readonly string[],
    args: {
      mode?: number;
      atimeMs?: number;
      mtimeMs?: number;
      dev: number;
      ino: number;
    },
  ): Promise<FileOpAnswer> {
    const opened = await openVerified(root, segments, "chmod", {
      dev: args.dev,
      ino: args.ino,
    });
    if (!opened.ok) return opened;
    try {
      if (args.mode !== undefined) await opened.handle.chmod(args.mode & 0o777);
      if (args.atimeMs !== undefined || args.mtimeMs !== undefined) {
        const atime = new Date(args.atimeMs ?? opened.info.atimeMs);
        const mtime = new Date(args.mtimeMs ?? opened.info.mtimeMs);
        await opened.handle.utimes(atime, mtime);
      }
      return { ok: true, result: attrsOf(await opened.handle.stat()) };
    } catch (err) {
      return { ok: false, errno: errnoOf(err) };
    } finally {
      await opened.handle.close().catch(() => {});
    }
  }

  async function createOp(
    root: string,
    segments: readonly string[],
    mode: number,
    exclusive: boolean,
  ): Promise<FileOpAnswer> {
    if (segments.length === 0) return { ok: false, errno: "EEXIST" };
    const parent = await parentOf(root, segments);
    if (!parent.ok) return parent;
    const name = segments.at(-1)!;
    return step(parent.path, parent.proved, () => {
      const existing = lstatSync(name, { throwIfNoEntry: false });
      if (existing !== undefined) {
        if (exclusive) return { ok: false, errno: "EEXIST" };
        if (existing.isSymbolicLink() || !existing.isFile())
          return { ok: false, errno: "EPERM" };
      }
      const flags =
        constants.O_WRONLY |
        constants.O_CREAT |
        constants.O_NOFOLLOW |
        constants.O_NONBLOCK |
        (exclusive ? constants.O_EXCL : 0);
      const fd = openSync(name, flags, mode & 0o777);
      try {
        const info = fstatSync(fd);
        const entry = lstatSync(name);
        if (entry.dev !== info.dev || entry.ino !== info.ino)
          return { ok: false, errno: "ESTALE" };
        if (!info.isFile() || info.nlink !== 1)
          return { ok: false, errno: "EPERM" };
        return { ok: true, result: attrsOf(info) };
      } finally {
        closeSync(fd);
      }
    });
  }

  async function mkdirOp(
    root: string,
    segments: readonly string[],
    mode: number,
  ): Promise<FileOpAnswer> {
    if (segments.length === 0) return { ok: false, errno: "EEXIST" };
    const parent = await parentOf(root, segments);
    if (!parent.ok) return parent;
    const name = segments.at(-1)!;
    return step(parent.path, parent.proved, () => {
      mkdirSync(name, { mode: mode & 0o777 });
      return { ok: true, result: attrsOf(lstatSync(name)) };
    });
  }

  async function unlinkOp(
    root: string,
    segments: readonly string[],
  ): Promise<FileOpAnswer> {
    if (segments.length === 0) return { ok: false, errno: "EBUSY" };
    const parent = await parentOf(root, segments);
    if (!parent.ok) return parent;
    const name = segments.at(-1)!;
    return step(parent.path, parent.proved, () => {
      unlinkSync(name);
      return { ok: true };
    });
  }

  async function rmdirOp(
    root: string,
    segments: readonly string[],
  ): Promise<FileOpAnswer> {
    if (segments.length === 0) return { ok: false, errno: "EBUSY" };
    const parent = await parentOf(root, segments);
    if (!parent.ok) return parent;
    const name = segments.at(-1)!;
    return step(parent.path, parent.proved, () => {
      rmdirSync(name);
      return { ok: true };
    });
  }

  async function renameOp(
    root: string,
    fromSegments: readonly string[],
    toSegments: readonly string[],
  ): Promise<FileOpAnswer> {
    if (fromSegments.length === 0 || toSegments.length === 0)
      return { ok: false, errno: "EBUSY" };
    const source = await entryOf(root, fromSegments);
    if (!source.ok) return source;
    if (
      (source.info.isDirectory() || source.info.isSymbolicLink()) &&
      toSegments.length < fromSegments.length
    )
      return { ok: false, errno: "EXDEV" };

    const fromParent = await parentOf(root, fromSegments);
    if (!fromParent.ok) return fromParent;
    const toParent = await parentOf(root, toSegments);
    if (!toParent.ok) return toParent;
    const fromName = fromSegments.at(-1)!;
    const toPath = resolveInside(toParent.path, [toSegments.at(-1)!]);
    if (toPath === null) return { ok: false, errno: "EACCES" };

    return step(fromParent.path, fromParent.proved, () => {
      const target = lstatSync(toParent.path, { throwIfNoEntry: false });
      if (
        target === undefined ||
        !target.isDirectory() ||
        target.dev !== toParent.proved.dev ||
        target.ino !== toParent.proved.ino
      )
        return { ok: false, errno: "ESTALE" };
      const current = lstatSync(fromName, { throwIfNoEntry: false });
      if (
        current === undefined ||
        kindOf(current) !== kindOf(source.info) ||
        current.dev !== source.info.dev ||
        current.ino !== source.info.ino
      )
        return { ok: false, errno: "ESTALE" };
      renameSync(fromName, toPath);
      const moved = lstatSync(toPath, { throwIfNoEntry: false });
      if (
        moved === undefined ||
        moved.dev !== source.info.dev ||
        moved.ino !== source.info.ino
      )
        return { ok: false, errno: "EIO" };
      return { ok: true };
    });
  }

  async function symlinkOp(
    root: string,
    segments: readonly string[],
    target: string,
  ): Promise<FileOpAnswer> {
    if (segments.length === 0) return { ok: false, errno: "EEXIST" };
    if (!targetStaysInside(target, segments.length - 1))
      return { ok: false, errno: "EPERM" };
    const parent = await parentOf(root, segments);
    if (!parent.ok) return parent;
    const name = segments.at(-1)!;
    return step(parent.path, parent.proved, () => {
      symlinkSync(target, name);
      const made = lstatSync(name, { throwIfNoEntry: false });
      if (made === undefined || !made.isSymbolicLink())
        return { ok: false, errno: "EIO" };
      return { ok: true };
    });
  }

  async function readlinkOp(
    root: string,
    segments: readonly string[],
  ): Promise<FileOpAnswer> {
    const entry = await entryOf(root, segments);
    if (!entry.ok) return entry;
    if (!entry.info.isSymbolicLink()) return { ok: false, errno: "EINVAL" };
    const target = await readlink(entry.path).catch(() => null);
    if (target === null) return { ok: false, errno: "EIO" };
    if (!targetStaysInside(target, segments.length - 1))
      return { ok: false, errno: "EACCES" };
    return { ok: true, result: { target } };
  }

  async function statfsOp(root: string): Promise<FileOpAnswer> {
    const info = await statfs(root).catch(() => null);
    if (info === null) return { ok: false, errno: "EIO" };
    return {
      ok: true,
      result: {
        bsize: info.bsize,
        blocks: info.blocks,
        bfree: info.bfree,
        bavail: info.bavail,
        files: info.files,
        ffree: info.ffree,
      },
    };
  }

  async function run(request: FileOpRequest): Promise<FileOpAnswer> {
    if (Date.now() > request.deadline) return { ok: false, errno: "EIO" };

    const payload: Record<string, unknown> = {
      ...request.args,
      op: request.op,
    };
    if (request.path !== undefined)
      payload[request.op === "rename" ? "from" : "path"] = request.path;
    if (request.data !== undefined) payload.data = request.data;

    const parsed = satelliteFileOpSchema.safeParse(payload);
    if (!parsed.success) return { ok: false, errno: "EINVAL" };
    const operation = parsed.data;
    if (satelliteFileOpMutates(operation) && !deps.writable)
      return { ok: false, errno: "EROFS" };

    const root = await rootNow();
    if (!root.ok) return root;

    const path = "path" in operation ? operation.path : operation.from;
    const segments = segmentsOf(path);
    if (segments === null) return { ok: false, errno: "EACCES" };

    switch (operation.op) {
      case "getattr":
        return getattrOp(root.root, segments);
      case "lookup":
        return lookupOp(
          root.root,
          segments,
          operation.parentDev,
          operation.parentIno,
        );
      case "readdir":
        return readdirOp(
          root.root,
          segments,
          operation.offset,
          operation.limit,
        );
      case "read":
        return readOp(
          root.root,
          segments,
          operation.offset,
          operation.size,
          operation.dev,
          operation.ino,
        );
      case "readlink":
        return readlinkOp(root.root, segments);
      case "open":
        return openOp(
          root.root,
          segments,
          operation.write,
          operation.dev,
          operation.ino,
        );
      case "create":
        return createOp(
          root.root,
          segments,
          operation.mode,
          operation.exclusive,
        );
      case "write":
        return writeOp(
          root.root,
          segments,
          operation.offset,
          Buffer.from(operation.data, "base64"),
          operation.dev,
          operation.ino,
        );
      case "truncate":
        return truncateOp(
          root.root,
          segments,
          operation.size,
          operation.dev,
          operation.ino,
        );
      case "setattr":
        return setattrOp(root.root, segments, operation);
      case "mkdir":
        return mkdirOp(root.root, segments, operation.mode);
      case "rmdir":
        return rmdirOp(root.root, segments);
      case "unlink":
        return unlinkOp(root.root, segments);
      case "rename": {
        const to = segmentsOf(operation.to);
        if (to === null) return { ok: false, errno: "EACCES" };
        return renameOp(root.root, segments, to);
      }
      case "symlink":
        return symlinkOp(root.root, segments, operation.target);
      case "statfs":
        return statfsOp(root.root);
    }
  }

  return { run };
}

export type FileOps = ReturnType<typeof createFileOps>;

export function rootLockPath(root: string, home: string = homedir()): string {
  const digest = createHash("sha256").update(root).digest("hex");
  return join(home, ".dam", LOCK_DIRECTORY, `${digest}.lock`);
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: One worker per root, kept as a pid file at
 * `~/.dam/satellite-files/<sha256(root)>.lock`. A change to the tree is proved
 * and then taken in one synchronous step, which is only sound while this process
 * is the one changing that tree: two workers on one directory would each prove and
 * step while the other moved entries underneath it, and neither's proof would mean
 * anything. The lock file is named in the refusal so the user can find and remove
 * it. A pid no process holds any more is replaced, so a machine that crashed needs
 * no cleanup by hand.
 *
 * The ceiling, stated: the lock is per root path, so a worker on `~/lab` and one on
 * `~/lab/sub` are not excluded from each other, though the second subtree sits
 * inside the first; a native `openat2`/`renameat2` would make each step hold on its
 * own and lift this.
 */
export async function lockRoot(
  root: string,
  home: string = homedir(),
): Promise<{ ok: true; release: () => void } | { ok: false; reason: string }> {
  const path = rootLockPath(root, home);
  await mkdir(dirname(path), { recursive: true, mode: 0o700 }).catch(
    () => null,
  );
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await writeFile(path, String(process.pid), { flag: "wx", mode: 0o600 });
      const release = (): void => {
        try {
          if (readFileSync(path, "utf8").trim() !== String(process.pid)) return;
          rmSync(path, { force: true });
        } catch {
          return;
        }
      };
      process.once("exit", release);
      return { ok: true, release };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST")
        return { ok: false, reason: `could not lock ${root}: ${String(err)}` };
      const held = Number(
        (await readFile(path, "utf8").catch(() => "")).trim(),
      );
      if (Number.isInteger(held) && held > 0 && pidAlive(held))
        return {
          ok: false,
          reason: `${root} is already served by another worker (pid ${held}, lock ${path}) — stop it first`,
        };
      await rm(path, { force: true }).catch(() => null);
    }
  }
  return { ok: false, reason: `could not lock ${root}` };
}
