import type { ChainableCommander, Redis } from "ioredis";
import type { HoldWaiters } from "../services/held-verdict.js";

const KEY_PREFIX = "approval-waiters:";
const LEASE_MS = 90_000;

// UNIT_BOUNDARY_DESCRIPTION: the waiter count of held requests in Redis, as one sorted set per approval: each wait is a member whose score is the end of its lease. Every write drops the members whose lease ended and keeps the key a little longer than a lease, so an approval nobody waits on any more leaves no key behind.
export function createHoldWaiters(redis: Redis): HoldWaiters {
  const keyOf = (approvalId: string) => `${KEY_PREFIX}${approvalId}`;

  async function countAfter(
    approvalId: string,
    change: (pipeline: ChainableCommander, key: string, now: number) => void,
  ): Promise<number> {
    const key = keyOf(approvalId);
    const now = Date.now();
    const pipeline = redis.multi();
    change(pipeline, key, now);
    pipeline.zremrangebyscore(key, "-inf", now);
    pipeline.pexpire(key, LEASE_MS * 2);
    pipeline.zcard(key);
    const results = await pipeline.exec();
    const last = results?.at(-1);
    if (!last || last[0]) throw last?.[0] ?? new Error("waiter count failed");
    return Number(last[1]);
  }

  return {
    enter: (approvalId, waitId) =>
      countAfter(approvalId, (pipeline, key, now) =>
        pipeline.zadd(key, now + LEASE_MS, waitId),
      ),
    leave: (approvalId, waitId) =>
      countAfter(approvalId, (pipeline, key) => pipeline.zrem(key, waitId)),
    count: (approvalId) => countAfter(approvalId, () => {}),
  };
}
