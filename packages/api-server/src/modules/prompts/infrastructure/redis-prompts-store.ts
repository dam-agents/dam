import Redis, { type Redis as RedisClient } from "ioredis";

const STREAM_KEY = "prompts:outbox";
const IDEMP_PREFIX = "prompts:idemp:";
const IDEMP_TTL_SEC = 3600;
const GROUP_NAME = "forwarders";

/**
 * Atomic dedup-or-append. Either returns the existing stream id for this
 * idempotency key (a UI retry within the TTL window) or atomically:
 *   1. XADD a new entry under field `envelope`
 *   2. SET prompts:idemp:<key> = streamId, EX 3600
 * Returns `[streamId, "1"]` on dedup hit, `[streamId, "0"]` on append.
 *
 * The two operations together prevent the classic check-then-act race:
 * two concurrent calls with the same key both see no existing id, both
 * XADD, both SET — duplicate messages downstream. Lua makes the pair a
 * single atomic step.
 */
const DEDUP_OR_APPEND_LUA = `
  local existing = redis.call("GET", KEYS[1])
  if existing then return {existing, "1"} end
  local id = redis.call("XADD", KEYS[2], "*", "envelope", ARGV[1])
  redis.call("SET", KEYS[1], id, "EX", ARGV[2])
  return {id, "0"}
`;

export interface DedupOrAppendResult {
  streamId: string;
  deduped: boolean;
}

export interface PendingEntry {
  id: string;
  envelope: string;
}

export interface PromptsStore {
  dedupOrAppend(idempotencyKey: string, envelope: string): Promise<DedupOrAppendResult>;
  /** Idempotent. Throws on non-`BUSYGROUP` errors. */
  ensureGroup(): Promise<void>;
  /** Block-read up to `count` fresh entries. Empty array on timeout. */
  read(consumerName: string, count: number, blockMs: number): Promise<PendingEntry[]>;
  /** Reclaim entries idle ≥ `idleMs` (dead consumers, our own past failures). */
  autoClaim(consumerName: string, idleMs: number, count: number): Promise<PendingEntry[]>;
  ack(id: string): Promise<void>;
  /** Trim after ack — keeps `prompts:outbox` from growing unboundedly. */
  trim(id: string): Promise<void>;
  close(): Promise<void>;
}

export interface RedisPromptsStoreOptions {
  password?: string;
}

export function createRedisPromptsStore(
  url: string,
  opts: RedisPromptsStoreOptions = {},
): PromptsStore {
  // Two clients: one for short ops (XADD, XACK, XAUTOCLAIM, EVAL), one
  // dedicated to the long-blocking XREADGROUP. ioredis serializes commands
  // per connection, so a blocking read on the writer would jam every
  // dedup-or-append call until BLOCK fires.
  const baseOpts = {
    lazyConnect: false,
    maxRetriesPerRequest: null,
    password: opts.password,
  };
  const writer: RedisClient = new Redis(url, baseOpts);
  const reader: RedisClient = new Redis(url, baseOpts);

  function parseEntries(
    entries: Array<[string, string[]]>,
  ): PendingEntry[] {
    const out: PendingEntry[] = [];
    for (const [id, fields] of entries) {
      // fields is [name1, value1, name2, value2, ...]; we only set one
      // field (`envelope`) so a linear scan is fine.
      for (let i = 0; i < fields.length; i += 2) {
        if (fields[i] === "envelope") {
          out.push({ id, envelope: fields[i + 1]! });
          break;
        }
      }
    }
    return out;
  }

  return {
    async dedupOrAppend(idempotencyKey, envelope) {
      const idempKey = `${IDEMP_PREFIX}${idempotencyKey}`;
      const result = (await writer.eval(
        DEDUP_OR_APPEND_LUA,
        2,
        idempKey,
        STREAM_KEY,
        envelope,
        String(IDEMP_TTL_SEC),
      )) as [string, string];
      return { streamId: result[0], deduped: result[1] === "1" };
    },

    async ensureGroup() {
      try {
        await writer.xgroup("CREATE", STREAM_KEY, GROUP_NAME, "$", "MKSTREAM");
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (!msg.includes("BUSYGROUP")) throw err;
      }
    },

    async read(consumerName, count, blockMs) {
      // XREADGROUP returns: [[stream, [[id, [field, value, ...]], ...]]] or null on timeout.
      const res = (await reader.xreadgroup(
        "GROUP", GROUP_NAME, consumerName,
        "COUNT", String(count),
        "BLOCK", String(blockMs),
        "STREAMS", STREAM_KEY, ">",
      )) as Array<[string, Array<[string, string[]]>]> | null;
      if (!res) return [];
      const out: PendingEntry[] = [];
      for (const [, entries] of res) out.push(...parseEntries(entries));
      return out;
    },

    async autoClaim(consumerName, idleMs, count) {
      // XAUTOCLAIM <key> <group> <consumer> <min-idle-ms> <start-id> COUNT <count>
      // Reclaims pending entries idle ≥ min-idle from any consumer (including
      // ourselves on retry) and re-assigns them to `consumerName`. The "0"
      // start-id scans from the beginning of the pending list.
      const res = (await writer.xautoclaim(
        STREAM_KEY,
        GROUP_NAME,
        consumerName,
        String(idleMs),
        "0",
        "COUNT",
        String(count),
      )) as [string, Array<[string, string[]]>, string[]];
      return parseEntries(res[1]);
    },

    async ack(id) {
      await writer.xack(STREAM_KEY, GROUP_NAME, id);
    },

    async trim(id) {
      await writer.xdel(STREAM_KEY, id);
    },

    async close() {
      await Promise.all([writer.quit(), reader.quit()]);
    },
  };
}
