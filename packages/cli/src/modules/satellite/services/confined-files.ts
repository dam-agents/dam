import { realpathSync, statSync, type Stats } from "node:fs";
import { lstat, realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, relative, resolve, sep } from "node:path";

/**
 * UNIT_BOUNDARY_DESCRIPTION: A file on the user's machine read or written
 * through one directory, without trusting a path component. The machine is the
 * user's own, but the caller is a prompt-injectable Agent, so an operation must
 * not be steerable outside the root: every directory on the way is `lstat`ed and
 * must be real, and the last name is never reached through a link.
 *
 * A change is taken *inside* the verified parent directory: the process moves
 * into that directory's inode, proves it is still the one that was checked, and
 * then names the entry relatively. No other JavaScript can run between the proof
 * and the step, so renaming a path on top of it cannot redirect the step — the
 * guarantee `openat`/`renameat` give, which Node does not expose.
 *
 * The ceiling, stated: the working directory is process-wide while the step
 * runs, so code on another thread using a relative path would see it (this
 * package has none). The upgrade is a native `openat2`/`renameat2`.
 */

export function platformRefusal(): string | null {
  return process.platform === "win32"
    ? "a files satellite needs a POSIX machine — this build cannot confine a path on Windows"
    : null;
}

export type Refusal = "outside" | "no-such-file" | "not-writable" | "changed";

export type FileKind = "file" | "dir" | "link" | "other";

export function kindOf(info: Stats): FileKind {
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

export interface Proved {
  dev: number;
  ino: number;
}

async function realDirectory(path: string): Promise<boolean> {
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
): Promise<Walked> {
  if ((await realpath(root).catch(() => null)) !== root)
    return { ok: false, reason: "outside" };
  let current = root;
  for (const segment of segments) {
    const next = resolveInside(current, [segment]);
    if (next === null) return { ok: false, reason: "outside" };
    if ((await lstat(next).catch(() => null)) === null)
      return { ok: false, reason: "no-such-file" };
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
export function insideDirectory<T>(
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
