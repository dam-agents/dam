import { readdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";

import { STAGING_PREFIX } from "./constants.js";

const MAX_AGE_MS = 10 * 60 * 1000;

/**
 * Remove leftover `.import-staging-*` directories under `homeDir` older than
 * 10 minutes. Boot-only (no import is in flight at boot), so the age is just a
 * clock-skew guard; these are orphans from a previous pod's crashed import.
 *
 * Best-effort: errors are logged but do not abort boot.
 */
export async function sweepStaging(
  homeDir: string,
  log: (msg: string) => void,
): Promise<void> {
  let entries: string[];
  try {
    entries = await readdir(homeDir);
  } catch (err) {
    log(`sweep: cannot read ${homeDir}: ${(err as Error).message}`);
    return;
  }
  const now = Date.now();
  for (const name of entries) {
    if (!name.startsWith(STAGING_PREFIX)) continue;
    const abs = join(homeDir, name);
    try {
      const s = await stat(abs);
      if (now - s.mtimeMs < MAX_AGE_MS) continue;
      await rm(abs, { recursive: true, force: true });
      log(`sweep: removed stale staging dir ${name}`);
    } catch (err) {
      log(`sweep: failed to remove ${name}: ${(err as Error).message}`);
    }
  }
}
