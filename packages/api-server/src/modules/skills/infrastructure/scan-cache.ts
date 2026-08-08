import type { Skill } from "api-server-api";

const CACHE_TTL_MS = 5 * 60 * 1000;

/**
 * What a scan's result depended on, and therefore who may be served it.
 *
 * This describes the *scan*, not the repository: a publicly readable repo that
 * reached the credentialed path is still `agent`-scoped, because the result
 * came back through one sandbox's access.
 *
 * The credentialed scope is per **sandbox**, not per user: connections are
 * granted to one sandbox at a time, so two sandboxes of the same owner can see
 * different repositories. Scoping to the owner would let a sandbox with no
 * GitHub connection be served a list its own credentials could never fetch —
 * and then fail to install from it.
 */
export type ScanScope =
  | { kind: "shared" }
  | { kind: "agent"; owner: string; agentId: string };

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
  /** Serve `(scope, gitUrl, path)` from cache while fresh, otherwise run
   *  `scanner` and record the read. A throwing scanner caches nothing. */
  scan: (
    scope: ScanScope,
    gitUrl: string,
    path: string | undefined,
    scanner: (gitUrl: string) => Promise<Skill[]>,
  ) => Promise<ScanResult>;
  /** Drop every scope's cached listing for a `(gitUrl, path)` so the next scan
   *  hits upstream. Called on successful publish + manual refresh: the upstream
   *  moved, which is true no matter whose access read it. */
  invalidate: (gitUrl: string, path: string | undefined) => void;
}

function sourceKey(gitUrl: string, path: string | undefined): string {
  // NUL separator can't appear in a URL or a validated path, so the key is
  // collision-proof across (gitUrl, path) pairs.
  return `${gitUrl}\0${path ?? ""}`;
}

function scopeLabel(scope: ScanScope): string {
  // The owner rides the key alongside the agent id even though ids are already
  // unique — the key alone is what stands between a lookup and another user's
  // list, so it should not depend on id allocation to be safe.
  return scope.kind === "shared"
    ? "shared"
    : `agent:${scope.owner}:${scope.agentId}`;
}

/**
 * A scan cache keyed by `(gitUrl, path, scope)`. An entry from a scan that ran
 * under one sandbox's credentials is never served to another; an
 * uncredentialed scan, whose result is the same for every caller, is shared
 * across all of them.
 *
 * Scope is part of the key rather than a check applied to a shared slot, so
 * two sandboxes reading the same private source hold separate entries instead
 * of evicting each other on every request — and no comparison stands between a
 * lookup and another reader's skills.
 *
 * That multiplies entries by the number of sandboxes, so a miss first drops
 * everything expired: the map holds roughly what was scanned in the last TTL
 * window rather than growing for the life of the process. Only credentialed
 * scans multiply — a public source stays on one `shared` entry, which is the
 * common case.
 *
 * State is closure-scoped so callers hold the lifetime: the composition root
 * keeps one instance for the process (the service is re-composed per request,
 * so a per-service cache would never hit), and tests take a fresh one.
 */
export function createScanCache(
  log: (msg: string) => void = (msg) => process.stderr.write(msg),
): ScanCache {
  const entries = new Map<string, CacheEntry>();

  function dropExpired(now: number): void {
    for (const [key, entry] of entries) {
      if (entry.expiresAt <= now) entries.delete(key);
    }
  }

  return {
    async scan(scope, gitUrl, path, scanner) {
      const source = sourceKey(gitUrl, path);
      const label = scopeLabel(scope);
      const hit = entries.get(`${source}\0${label}`);
      if (hit && hit.expiresAt > Date.now()) {
        log(`[skills] cache hit: ${source} (${label})\n`);
        return { skills: hit.skills, scannedAt: hit.scannedAt };
      }
      log(`[skills] cache miss: ${source} (${label})\n`);
      const skills = await scanner(gitUrl);
      const scannedAt = Date.now();
      dropExpired(scannedAt);
      entries.set(`${source}\0${label}`, {
        skills,
        expiresAt: scannedAt + CACHE_TTL_MS,
        scannedAt,
      });
      return { skills, scannedAt };
    },

    invalidate(gitUrl, path) {
      // Every scope's entry for this source, whoever produced it. The trailing
      // NUL stops the prefix at the source boundary, so a longer gitUrl sharing
      // this one's opening characters is untouched.
      const source = sourceKey(gitUrl, path);
      let dropped = 0;
      for (const key of entries.keys()) {
        if (key.startsWith(`${source}\0`) && entries.delete(key)) dropped++;
      }
      if (dropped > 0) {
        log(`[skills] cache invalidated: ${source} (${dropped})\n`);
      }
    },
  };
}
