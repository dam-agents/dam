import type { Redis } from "ioredis";
import { z } from "zod";
import type { StatusSnapshot } from "../domain/status.js";

export interface StatusSnapshots {
  read(): Promise<StatusSnapshot | null>;
  write(snapshot: StatusSnapshot): Promise<void>;
}

const SNAPSHOT_KEY = "provider-status:snapshot";
const SNAPSHOT_TTL_SECONDS = 3 * 60;

const snapshotSchema = z.object({
  checkedAt: z.string(),
  degraded: z.array(
    z.object({
      templateId: z.string(),
      reason: z.enum(["failing-calls", "unreachable", "provider-reported"]),
      since: z.string(),
    }),
  ),
  damSide: z.object({ since: z.string() }).nullable(),
  streaks: z
    .partialRecord(
      z.enum(["curve-bender", "ibm-litellm", "claude", "openai", "bob"]),
      z.object({ failedRuns: z.number(), since: z.string() }),
    )
    .default({}),
});

export function createRedisStatusSnapshots(redis: Redis): StatusSnapshots {
  return {
    async read() {
      const raw = await redis.get(SNAPSHOT_KEY);
      if (raw === null) return null;
      let json: unknown;
      try {
        json = JSON.parse(raw);
      } catch {
        return null;
      }
      const parsed = snapshotSchema.safeParse(json);
      return parsed.success ? parsed.data : null;
    },

    async write(snapshot) {
      await redis.set(
        SNAPSHOT_KEY,
        JSON.stringify(snapshot),
        "EX",
        SNAPSHOT_TTL_SECONDS,
      );
    },
  };
}
