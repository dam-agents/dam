import { mkdir, readdir, rename, rm } from "node:fs/promises";
import { join } from "node:path";

export type FinalizeResult = {
  topLevelPaths: string[];
};

export async function finalize(
  stagingDir: string,
  destDir: string,
): Promise<FinalizeResult> {
  await mkdir(destDir, { recursive: true });
  const topLevel = await readdir(stagingDir);
  for (const name of topLevel) {
    const srcPath = join(stagingDir, name);
    const dstPath = join(destDir, name);
    await rm(dstPath, { recursive: true, force: true });
    await rename(srcPath, dstPath);
  }
  return { topLevelPaths: topLevel };
}
