import { lstat, mkdir, readdir, rename, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { err, ok, type Result } from "agent-runtime-api";

import type { ImportDomainError } from "./errors.js";

export type FinalizeMode = "replace" | "merge";

export type FinalizeResult = {
  topLevelPaths: string[];
};

/**
 * Move the contents of `stagingDir` into `destDir + prefix` per `mode`.
 *
 * - "replace": for each top-level entry of `stagingDir`, interleave
 *   `rm -rf` + `rename` per entry so a crash mid-loop loses at most one
 *   top-level path rather than wiping the whole set ahead of any renames.
 * - "merge": move every file from staging onto dest, overwriting
 *   same-path files. Existing-only paths are left alone. Directory
 *   collisions are merged recursively; symlinks at the destination are
 *   never followed — they're treated as leaf targets to overwrite.
 *
 * Both modes refuse to operate outside `destDir`.
 */
export async function finalize(
  stagingDir: string,
  destDir: string,
  prefix: string,
  mode: FinalizeMode,
): Promise<Result<FinalizeResult, ImportDomainError>> {
  const destRoot = resolve(destDir);
  const target = resolve(destRoot, prefix);
  if (target !== destRoot && !target.startsWith(destRoot + "/")) {
    return err({ kind: "PrefixEscape", prefix });
  }
  await mkdir(target, { recursive: true });

  const topLevel = await readdir(stagingDir);

  if (mode === "replace") {
    // Per-entry interleave: rm-then-rename one entry at a time so the
    // crash window is a single entry, not the entire top-level set.
    // True atomicity would need renameat2(RENAME_EXCHANGE) which Node
    // doesn't expose — see ADR-DRAFT-file-import "Consequences".
    for (const name of topLevel) {
      await rm(join(target, name), { recursive: true, force: true });
      await rename(join(stagingDir, name), join(target, name));
    }
    return ok({ topLevelPaths: topLevel });
  }

  await mergeWalk(stagingDir, target);
  return ok({ topLevelPaths: topLevel });
}

async function mergeWalk(src: string, dst: string): Promise<void> {
  await mkdir(dst, { recursive: true });
  for (const name of await readdir(src)) {
    const srcPath = join(src, name);
    const dstPath = join(dst, name);
    // lstat (not stat) at the destination: a pre-existing symlink in dest
    // must not be followed — recursing into a symlink target would write
    // files outside `destDir`. The src tree is already symlink-free
    // (extract.ts rejects symlink entries), so source-side lstat-vs-stat
    // doesn't matter; we lstat both for consistency.
    const srcStat = await lstat(srcPath);
    let dstStat: Awaited<ReturnType<typeof lstat>> | null = null;
    try { dstStat = await lstat(dstPath); } catch { /* missing — fine */ }

    if (srcStat.isDirectory() && (!dstStat || dstStat.isDirectory())) {
      await mergeWalk(srcPath, dstPath);
      continue;
    }
    // Any other case (src is a file, OR dst is a symlink / regular file
    // colliding with a src dir) → atomic rename overwrites whatever's
    // there. POSIX rename replaces a symlink by name, not by following
    // it. Staging is on the same PVC as dest so cross-device fallback
    // isn't needed.
    if (dstStat) await rm(dstPath, { recursive: true, force: true });
    await rename(srcPath, dstPath);
  }
}
