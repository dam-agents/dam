import { randomUUID } from "node:crypto";
import type { Redis } from "ioredis";

export interface BlobHandoff {
  put(data: Buffer): Promise<string>;
  take(key: string): Promise<Buffer | null>;
}

const TTL_SECONDS = 120;

export function createRedisBlobHandoff(redis: Redis): BlobHandoff {
  return {
    async put(data) {
      const key = `blob:${randomUUID()}`;
      await redis.set(key, data, "EX", TTL_SECONDS);
      return key;
    },

    async take(key) {
      return (await redis.getdelBuffer(key)) ?? null;
    },
  };
}
