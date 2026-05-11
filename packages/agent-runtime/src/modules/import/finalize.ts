import { mkdir, readdir, rename, rm, stat } from "node:fs/promises";
import { join, resolve } from "node:path";

export type FinalizeMode = "replace" | "merge";

export type FinalizeResult = {
  topLevelPaths: string[];
};

/**
 * Move the contents of `stagingDir` into `destDir + prefix` per `mode`.
 *
 * - "replace": for each top-level entry of `stagingDir`, `rm -rf` the
 *   matching path in dest before moving the new tree in. Other paths
 *   in dest are left alone.
 * - "merge": move every file from staging onto dest, overwriting
 *   same-path files. Existing-only paths are left alone. Directory
 *   collisions are merged recursively.
 *
 * Both modes refuse to operate outside `destDir`.
 */
export async function finalize(
  stagingDir: string,
  destDir: string,
  prefix: string,
  mode: FinalizeMode,
): Promise<FinalizeResult> {
  const destRoot = resolve(destDir);
  const target = resolve(destRoot, prefix);
  if (target !== destRoot && !target.startsWith(destRoot + "/")) {
    throw new Error(`prefix ${JSON.stringify(prefix)} escapes destination`);
  }
  await mkdir(target, { recursive: true });

  const topLevel = await readdir(stagingDir);

  if (mode === "replace") {
    for (const name of topLevel) {
      await rm(join(target, name), { recursive: true, force: true });
    }
    for (const name of topLevel) {
      await rename(join(stagingDir, name), join(target, name));
    }
    return { topLevelPaths: topLevel };
  }

  await mergeWalk(stagingDir, target);
  return { topLevelPaths: topLevel };
}

async function mergeWalk(src: string, dst: string): Promise<void> {
  await mkdir(dst, { recursive: true });
  for (const name of await readdir(src)) {
    const srcPath = join(src, name);
    const dstPath = join(dst, name);
    const s = await stat(srcPath);
    if (s.isDirectory()) {
      await mergeWalk(srcPath, dstPath);
    } else {
      // POSIX rename overwrites; staging is on the same PVC as dest
      // so cross-device fallback isn't needed.
      await rename(srcPath, dstPath);
    }
  }
}
