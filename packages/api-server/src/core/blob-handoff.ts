import { randomUUID } from "node:crypto";
import type { Redis } from "ioredis";

/**
 * Short-lived binary handoff between replicas, for bytes that cannot ride the
 * JSON bus. The channel rpc needs exactly one: an outbound message may carry a
 * file attachment, read into a Buffer on the replica the agent's gateway is
 * pinned to and posted by the replica holding the channel lease.
 *
 * `JSON.stringify` turns a Buffer into `{type:"Buffer",data:[…]}` — a plain
 * object on the far side, not a Buffer — so the attachment would arrive
 * corrupt. It also inflates ~4x, and a 10 MiB attachment (the cap the MCP tool
 * enforces) would exceed the default 32 MB pub/sub client output buffer and
 * get the subscriber dropped. So the bytes go in a key and only its name
 * crosses the bus.
 *
 * Values are read binary-safe (`getBuffer`) and deleted on read. A handoff
 * whose reader never arrives expires on its own.
 */
export interface BlobHandoff {
  /** Stash bytes and return the key naming them. */
  put(data: Buffer): Promise<string>;
  /** Fetch and delete. Null when the key expired or was already taken. */
  take(key: string): Promise<Buffer | null>;
}

export function createRedisBlobHandoff(
  redis: Redis,
  ttlSeconds = 120,
): BlobHandoff {
  return {
    async put(data) {
      const key = `blob:${randomUUID()}`;
      await redis.set(key, data, "EX", ttlSeconds);
      return key;
    },

    async take(key) {
      // GET then DEL rather than GETDEL: ioredis decodes a Lua/GETDEL reply as
      // utf8, which corrupts binary. The extra round trip is the price of
      // `getBuffer`. A reader that dies between the two leaves the key to its
      // TTL.
      const data = await redis.getBuffer(key);
      if (data) await redis.del(key).catch(() => {});
      return data ?? null;
    },
  };
}
