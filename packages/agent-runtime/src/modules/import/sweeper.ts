import { readdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";

import { IMPORT_STAGING_PREFIX } from "../../core/import-staging.js";

const MAX_AGE_MS = 60 * 60 * 1000;

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
    if (!name.startsWith(IMPORT_STAGING_PREFIX)) continue;
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
