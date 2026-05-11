import { stat } from "node:fs/promises";
import { resolve } from "node:path";

/**
 * Given a list of top-level path segments and a destination prefix,
 * return the subset that already exists under `destDir + prefix`.
 *
 * "Top-level" means each entry must be a single path segment — the
 * first directory or file the bundle would write at the root of the
 * destination. Callers derive this set from their input (UI walks the
 * dropped tree client-side; CLI later from its tar manifest).
 */
export async function preflight(
  topLevelPaths: string[],
  destDir: string,
  prefix: string,
): Promise<{ conflicts: string[] }> {
  const destRoot = resolve(destDir);
  const target = resolve(destRoot, prefix);
  if (target !== destRoot && !target.startsWith(destRoot + "/")) {
    throw new Error(`prefix ${JSON.stringify(prefix)} escapes destination`);
  }
  const conflicts: string[] = [];
  for (const name of topLevelPaths) {
    if (name.includes("/") || name.includes("\\") || name === "." || name === "..") {
      throw new Error(`refusing non-top-level preflight path: ${name}`);
    }
    try {
      await stat(resolve(target, name));
      conflicts.push(name);
    } catch {
      // does not exist — not a conflict
    }
  }
  return { conflicts };
}
