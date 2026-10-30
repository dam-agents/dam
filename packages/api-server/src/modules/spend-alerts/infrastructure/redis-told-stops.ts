import type { Redis } from "ioredis";

const KEPT_AFTER_RESET_MS = 60 * 60 * 1000;

export interface ToldStops {
  told(key: string): Promise<boolean>;
  claim(key: string, reset: Date, now: Date): Promise<boolean>;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: the stops that an owner was told about, one
 * Redis key each, claimed with SET NX before the message goes out. Every
 * replica holds work and refuses calls, so the claim is what keeps two
 * replicas from sending the same message. A key lives until an hour after the
 * day it counts ends, when its level cannot stop work any more.
 */
export function createRedisToldStops(redis: Redis): ToldStops {
  return {
    async told(key) {
      return (await redis.exists(key)) === 1;
    },
    async claim(key, reset, now) {
      const seconds = Math.max(
        60,
        Math.ceil(
          (reset.getTime() + KEPT_AFTER_RESET_MS - now.getTime()) / 1000,
        ),
      );
      return (await redis.set(key, "1", "EX", seconds, "NX")) === "OK";
    },
  };
}
