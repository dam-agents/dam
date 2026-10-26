import type { Redis } from "ioredis";
import { z } from "zod";

import { FAILED_WORK_KEPT_MS, type FailedWork } from "../domain/failed-work.js";

export interface FailedWorkStore {
  record(templateId: string, work: FailedWork, at: Date): Promise<void>;
  since(templateId: string, since: Date): Promise<FailedWork[]>;
}

const keyOf = (templateId: string) => `outage-alerts:failed-work:${templateId}`;

const failedWorkSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("session"),
    agentId: z.string(),
    sessionId: z.string(),
  }),
]);

function parsed(member: string): FailedWork | null {
  try {
    const work = failedWorkSchema.safeParse(JSON.parse(member));
    return work.success ? work.data : null;
  } catch {
    return null;
  }
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: the failed unattended work per template, in
 * one Redis sorted set each, scored by the time of the failure. A repeated
 * failure of the same work keeps its latest time. Work older than a day
 * drops out, because no outage alert waits that long. Every replica writes
 * the failures it sees, and the evaluate run reads them on any replica.
 */
export function createRedisFailedWork(redis: Redis): FailedWorkStore {
  return {
    async record(templateId, work, at) {
      const key = keyOf(templateId);
      const results = await redis
        .multi()
        .zadd(key, "GT", at.getTime(), JSON.stringify(work))
        .zremrangebyscore(key, "-inf", at.getTime() - FAILED_WORK_KEPT_MS)
        .pexpire(key, FAILED_WORK_KEPT_MS)
        .exec();
      if (!results) throw new Error("redis transaction was discarded");
      for (const [err] of results) if (err) throw err;
    },

    async since(templateId, since) {
      const members = await redis.zrangebyscore(
        keyOf(templateId),
        since.getTime(),
        "+inf",
      );
      return members.flatMap((member) => parsed(member) ?? []);
    },
  };
}
