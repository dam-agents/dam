import { stat } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";
import { err, ok, type Result } from "agent-runtime-api";

import type { ImportDomainError } from "./errors.js";

/**
 * Zod schema for the preflight HTTP request body. Owned by the import
 * module so the http layer doesn't reinvent it.
 */
export const preflightInputSchema = z.object({
  paths: z.array(z.string()),
  prefix: z.string().optional(),
});

export type PreflightInput = z.infer<typeof preflightInputSchema>;

export type PreflightResult = { conflicts: string[] };

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
): Promise<Result<PreflightResult, ImportDomainError>> {
  const destRoot = resolve(destDir);
  const target = resolve(destRoot, prefix);
  if (target !== destRoot && !target.startsWith(destRoot + "/")) {
    return err({ kind: "PrefixEscape", prefix });
  }
  const conflicts: string[] = [];
  for (const name of topLevelPaths) {
    if (name.includes("/") || name.includes("\\") || name === "." || name === "..") {
      return err({ kind: "NonTopLevelPath", path: name });
    }
    try {
      await stat(resolve(target, name));
      conflicts.push(name);
    } catch {
      // does not exist — not a conflict
    }
  }
  return ok({ conflicts });
}
