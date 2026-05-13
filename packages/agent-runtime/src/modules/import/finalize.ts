import { lstat, mkdir, readdir, rename, rm } from "node:fs/promises";
import { join } from "node:path";

export type FinalizeResult = {
  topLevelPaths: string[];
};

/**
 * Recursively merge the contents of `stagingDir` into `destDir`.
 *
 * For each entry: if both sides are directories, recurse; otherwise the
 * staging entry replaces whatever is at the destination path via POSIX
 * `rename` (atomic for the individual file/dir). Unrelated existing
 * entries in `destDir` are left alone. Symlinks at the destination are
 * never followed — `rename` replaces the link itself.
 *
 * Staging is on the same PVC as the destination, so cross-device fallback
 * isn't needed. Per-file atomicity is the only atomicity claim; the bundle
 * as a whole is not transactional.
 */
export async function finalize(stagingDir: string, destDir: string): Promise<FinalizeResult> {
  await mkdir(destDir, { recursive: true });
  const topLevel = await readdir(stagingDir);
  await mergeWalk(stagingDir, destDir);
  return { topLevelPaths: topLevel };
}

async function mergeWalk(src: string, dst: string): Promise<void> {
  await mkdir(dst, { recursive: true });
  for (const name of await readdir(src)) {
    const srcPath = join(src, name);
    const dstPath = join(dst, name);
    // lstat at the destination: a pre-existing symlink must not be
    // followed — recursing into a symlink target would write outside
    // destDir. The src tree is already symlink-free (extract.ts rejects
    // symlink entries).
    const srcStat = await lstat(srcPath);
    let dstStat: Awaited<ReturnType<typeof lstat>> | null = null;
    try { dstStat = await lstat(dstPath); } catch { /* missing — fine */ }

    if (srcStat.isDirectory() && (!dstStat || dstStat.isDirectory())) {
      await mergeWalk(srcPath, dstPath);
      continue;
    }
    if (dstStat) await rm(dstPath, { recursive: true, force: true });
    await rename(srcPath, dstPath);
  }
}
