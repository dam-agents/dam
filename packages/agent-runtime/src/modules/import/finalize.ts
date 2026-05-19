import { mkdir, readdir, rename, rm } from "node:fs/promises";
import { join } from "node:path";

export type FinalizeResult = {
  topLevelPaths: string[];
};

/**
 * Land the contents of `stagingDir` into `destDir` by replacing each
 * top-level entry of the bundle wholesale.
 *
 * Semantics, per top-level entry of `stagingDir`:
 *  - If the destination has no entry by that name → `rename` it in.
 *  - If the destination has an entry by that name → `rm -rf` the
 *    destination entry, then `rename` the staging entry in.
 *
 * Destination entries whose names don't appear in the bundle are left
 * untouched. Folders are atomic units: importing `dirA/` replaces the
 * whole `dirA/`, not its individual files. Staging is on the same PVC
 * as `destDir`, so cross-device fallback isn't needed.
 *
 * Atomicity is scoped to the individual top-level entry. The whole
 * bundle is not transactional; a crash mid-loop leaves earlier entries
 * landed and later entries un-landed. A re-import converges because the
 * operation is idempotent in destination terms.
 */
export async function finalize(
  stagingDir: string,
  destDir: string,
): Promise<FinalizeResult> {
  await mkdir(destDir, { recursive: true });
  const topLevel = await readdir(stagingDir);
  for (const name of topLevel) {
    const srcPath = join(stagingDir, name);
    const dstPath = join(destDir, name);
    // rm-then-rename per top-level entry. The crash window between the
    // two ops is bounded to this single entry — earlier entries already
    // landed, later entries still in staging on retry.
    await rm(dstPath, { recursive: true, force: true });
    await rename(srcPath, dstPath);
  }
  return { topLevelPaths: topLevel };
}
