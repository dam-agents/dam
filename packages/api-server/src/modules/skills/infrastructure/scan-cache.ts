import type { Skill } from "api-server-api";
import { z } from "zod";
import type { RedisBus } from "../../../core/redis-bus.js";

const CACHE_TTL_MS = 5 * 60 * 1000;

export type ScanScope =
  | { kind: "shared" }
  | { kind: "agent"; owner: string; agentId: string };

interface CacheEntry {
  skills: Skill[];
  expiresAt: number;
  scannedAt: number;
}

export interface ScanResult {
  skills: Skill[];
  scannedAt: number;
}

export interface ScanCache {
  scan: (
    scope: ScanScope,
    gitUrl: string,
    path: string | undefined,
    scanner: (gitUrl: string) => Promise<Skill[]>,
  ) => Promise<ScanResult>;
  invalidate: (gitUrl: string, path: string | undefined) => void;
}

function sourceKey(gitUrl: string, path: string | undefined): string {
  return `${gitUrl}\0${path ?? ""}`;
}

function scopeLabel(scope: ScanScope): string {
  return scope.kind === "shared"
    ? "shared"
    : `agent:${scope.owner}:${scope.agentId}`;
}

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

const SCAN_INVALIDATE_CHANNEL = "skills:scan-invalidate";
const scanInvalidationSchema = z.object({
  gitUrl: z.string(),
  path: z.string().optional(),
});

export function wireScanCacheBus(
  cache: ScanCache,
  bus: RedisBus,
): (gitUrl: string, path?: string) => void {
  bus.subscribe(SCAN_INVALIDATE_CHANNEL, (payload) => {
    try {
      const parsed = scanInvalidationSchema.safeParse(JSON.parse(payload));
      if (parsed.success)
        cache.invalidate(parsed.data.gitUrl, parsed.data.path);
    } catch {}
  });
  return (gitUrl, path) =>
    void bus.publish(
      SCAN_INVALIDATE_CHANNEL,
      JSON.stringify({ gitUrl, ...(path === undefined ? {} : { path }) }),
    );
}
