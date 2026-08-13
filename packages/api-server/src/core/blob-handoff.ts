import { randomUUID } from "node:crypto";
import type { Redis } from "ioredis";

export interface BlobHandoff {
  put(data: Buffer): Promise<string>;
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
      const data = await redis.getBuffer(key);
      if (data) await redis.del(key).catch(() => {});
      return data ?? null;
    },
  };
}
