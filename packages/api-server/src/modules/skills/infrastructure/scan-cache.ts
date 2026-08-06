import type { Skill } from "api-server-api";

const CACHE_TTL_MS = 5 * 60 * 1000;

interface CacheEntry {
  skills: Skill[];
  expiresAt: number;
  /** Epoch ms of the upstream read this entry came from — carried to the UI so
   *  a source card can show how fresh its list is. A hit reports this original
   *  read rather than the moment of the hit. */
  scannedAt: number;
}

export interface ScanResult {
  skills: Skill[];
  scannedAt: number;
}

export interface ScanCache {
  /** Serve `(gitUrl, path)` from cache while fresh, otherwise run `scanner`
   *  and record the read. A throwing scanner caches nothing. */
  scan: (
    gitUrl: string,
    path: string | undefined,
    scanner: (gitUrl: string) => Promise<Skill[]>,
  ) => Promise<ScanResult>;
  /** Drop the cached listing for a `(gitUrl, path)` so the next scan hits
   *  upstream. Called on successful publish + manual refresh. */
  invalidate: (gitUrl: string, path: string | undefined) => void;
}

function cacheKey(gitUrl: string, path: string | undefined): string {
  // NUL separator can't appear in a URL or a validated path, so the key is
  // collision-proof across (gitUrl, path) pairs.
  return `${gitUrl}\0${path ?? ""}`;
}

/**
 * A scan cache keyed by `(gitUrl, path)` — the same repo pointed at different
 * subdirs yields different skills, but the result is independent of who's
 * asking, so one instance is shared across all users. Entries carry a 5-minute
 * TTL and the time of the upstream read they came from.
 *
 * State is closure-scoped so callers hold the lifetime: the composition root
 * keeps one instance for the process (the service is re-composed per request,
 * so a per-service cache would never hit), and tests take a fresh one.
 */
export function createScanCache(
  log: (msg: string) => void = (msg) => process.stderr.write(msg),
): ScanCache {
  const entries = new Map<string, CacheEntry>();

  return {
    async scan(gitUrl, path, scanner) {
      const key = cacheKey(gitUrl, path);
      const hit = entries.get(key);
      if (hit && hit.expiresAt > Date.now()) {
        log(`[skills] cache hit: ${key}\n`);
        return { skills: hit.skills, scannedAt: hit.scannedAt };
      }
      log(`[skills] cache miss: ${key}\n`);
      const skills = await scanner(gitUrl);
      const scannedAt = Date.now();
      entries.set(key, {
        skills,
        expiresAt: scannedAt + CACHE_TTL_MS,
        scannedAt,
      });
      return { skills, scannedAt };
    },

    invalidate(gitUrl, path) {
      const key = cacheKey(gitUrl, path);
      if (entries.delete(key)) {
        log(`[skills] cache invalidated: ${key}\n`);
      }
    },
  };
}
