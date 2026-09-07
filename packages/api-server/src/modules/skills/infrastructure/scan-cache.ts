import type { Skill } from "api-server-api";
import { z } from "zod";
import type { RedisBus } from "../../../core/redis-bus.js";

const FRESH_TTL_MS = 5 * 60 * 1000;
const STALE_TTL_MS = 30 * 60 * 1000;

export type ScanScope =
  | { kind: "shared" }
  | { kind: "agent"; owner: string; agentId: string };

interface CacheEntry {
  skills: Skill[];
  freshUntil: number;
  discardAt: number;
  scannedAt: number;
}

interface Attempt {
  discarded: boolean;
  result: Promise<ScanResult>;
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
  const inFlight = new Map<string, Attempt>();

  function dropExpired(now: number): void {
    for (const [key, entry] of entries) {
      if (entry.discardAt <= now) entries.delete(key);
    }
  }

  function read(
    key: string,
    gitUrl: string,
    scanner: (gitUrl: string) => Promise<Skill[]>,
  ): Promise<ScanResult> {
    const running = inFlight.get(key);
    if (running && !running.discarded) return running.result;

    const attempt: Attempt = {
      discarded: false,
      result: Promise.resolve().then(async () => {
        try {
          const skills = await scanner(gitUrl);
          const scannedAt = Date.now();
          if (!attempt.discarded) {
            dropExpired(scannedAt);
            entries.set(key, {
              skills,
              scannedAt,
              freshUntil: scannedAt + FRESH_TTL_MS,
              discardAt: scannedAt + STALE_TTL_MS,
            });
          }
          return { skills, scannedAt };
        } finally {
          if (inFlight.get(key) === attempt) inFlight.delete(key);
        }
      }),
    };
    inFlight.set(key, attempt);
    return attempt.result;
  }

  return {
    async scan(scope, gitUrl, path, scanner) {
      const source = sourceKey(gitUrl, path);
      const label = scopeLabel(scope);
      const key = `${source}\0${label}`;
      const now = Date.now();
      const hit = entries.get(key);

      if (hit && hit.discardAt > now) {
        if (hit.freshUntil > now) {
          log(`[skills] cache hit: ${source} (${label})\n`);
        } else {
          log(
            `[skills] cache hit, rescanning behind it: ${source} (${label})\n`,
          );
          void read(key, gitUrl, scanner).catch(() => {
            log(`[skills] background rescan failed: ${source} (${label})\n`);
          });
        }
        return { skills: hit.skills, scannedAt: hit.scannedAt };
      }

      log(`[skills] cache miss: ${source} (${label})\n`);
      return read(key, gitUrl, scanner);
    },

    invalidate(gitUrl, path) {
      const source = sourceKey(gitUrl, path);
      let dropped = 0;
      for (const key of entries.keys()) {
        if (key.startsWith(`${source}\0`) && entries.delete(key)) dropped++;
      }
      for (const [key, attempt] of inFlight) {
        if (key.startsWith(`${source}\0`)) attempt.discarded = true;
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
