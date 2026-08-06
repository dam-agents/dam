import type { Skill } from "api-server-api";

const CACHE_TTL_MS = 5 * 60 * 1000;

/**
 * What a scan's result depended on, and therefore who may be served it.
 *
 * This describes the *scan*, not the repository: a publicly readable repo that
 * reached the credentialed path is still `owner`-scoped, because the result
 * came back through one user's access.
 */
export type ScanScope = { kind: "shared" } | { kind: "owner"; owner: string };

interface CacheEntry {
  skills: Skill[];
  expiresAt: number;
  /** Epoch ms of the upstream read this entry came from — carried to the UI so
   *  a source card can show how fresh its list is. A hit reports this original
   *  read rather than the moment of the hit. */
  scannedAt: number;
  scope: ScanScope;
}

export interface ScanResult {
  skills: Skill[];
  scannedAt: number;
}

export interface ScanCache {
  /** Serve `(gitUrl, path)` from cache while the entry is fresh *and* was
   *  produced under the caller's scope, otherwise run `scanner` and record the
   *  read. A throwing scanner caches nothing. */
  scan: (
    scope: ScanScope,
    gitUrl: string,
    path: string | undefined,
    scanner: (gitUrl: string) => Promise<Skill[]>,
  ) => Promise<ScanResult>;
  /** Drop the cached listing for a `(gitUrl, path)` so the next scan hits
   *  upstream. Called on successful publish + manual refresh. Scope-blind:
   *  there is one entry per key whatever produced it. */
  invalidate: (gitUrl: string, path: string | undefined) => void;
}

function cacheKey(gitUrl: string, path: string | undefined): string {
  // NUL separator can't appear in a URL or a validated path, so the key is
  // collision-proof across (gitUrl, path) pairs.
  return `${gitUrl}\0${path ?? ""}`;
}

// Exact match, not "shared also satisfies owner". The service always tries the
// shared read first, so the permissive case would be unreachable, and an exact
// rule is the easier invariant to keep true.
function sameScope(a: ScanScope, b: ScanScope): boolean {
  if (a.kind === "shared") return b.kind === "shared";
  return b.kind === "owner" && a.owner === b.owner;
}

function scopeLabel(scope: ScanScope): string {
  return scope.kind === "shared" ? "shared" : `owner:${scope.owner}`;
}

/**
 * A scan cache keyed by `(gitUrl, path)`, holding one entry per key alongside
 * the scope that produced it. An entry from a scan that ran under one user's
 * credentials is never served to anyone else; an uncredentialed scan, whose
 * result is the same for every caller, is shared across all of them.
 *
 * A scope mismatch reads as a miss, so the caller's own scan simply overwrites
 * the slot — which is what keeps invalidation a single scope-blind delete.
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
    async scan(scope, gitUrl, path, scanner) {
      const key = cacheKey(gitUrl, path);
      const label = scopeLabel(scope);
      const hit = entries.get(key);
      if (hit && hit.expiresAt > Date.now() && sameScope(hit.scope, scope)) {
        log(`[skills] cache hit: ${key} (${label})\n`);
        return { skills: hit.skills, scannedAt: hit.scannedAt };
      }
      log(`[skills] cache miss: ${key} (${label})\n`);
      const skills = await scanner(gitUrl);
      const scannedAt = Date.now();
      entries.set(key, {
        skills,
        expiresAt: scannedAt + CACHE_TTL_MS,
        scannedAt,
        scope,
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
