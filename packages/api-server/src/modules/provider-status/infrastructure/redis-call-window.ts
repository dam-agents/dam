import type { Redis } from "ioredis";
import type { CallOutcome } from "../domain/outcome.js";
import {
  minuteOf,
  windowMinutes,
  WINDOW_MINUTES,
  type WindowBucket,
} from "../domain/window.js";

export interface CallWindow {
  count(outcome: CallOutcome): Promise<void>;
  read(now: Date): Promise<ReadonlyMap<string, readonly WindowBucket[]>>;
}

const KEY_TTL_SECONDS = (WINDOW_MINUTES + 1) * 60;

const templatesKey = (minute: number) => `provider-status:calls:${minute}`;
const bucketKey = (minute: number, templateId: string) =>
  `provider-status:calls:${minute}:${templateId}`;

type PipelineResults = [Error | null, unknown][] | null;

function resultsOf(results: PipelineResults): unknown[] {
  if (!results) throw new Error("redis pipeline was discarded");
  return results.map(([err, value]) => {
    if (err) throw err;
    return value;
  });
}

const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.map(String) : [];

export function createRedisCallWindow(redis: Redis): CallWindow {
  return {
    async count(outcome) {
      const minute = minuteOf(outcome.endedAt);
      const bucket = bucketKey(minute, outcome.templateId);
      const tx = redis
        .multi()
        .sadd(templatesKey(minute), outcome.templateId)
        .expire(templatesKey(minute), KEY_TTL_SECONDS)
        .hincrby(bucket, "calls", 1)
        .expire(bucket, KEY_TTL_SECONDS)
        .sadd(`${bucket}:agents`, outcome.payer)
        .expire(`${bucket}:agents`, KEY_TTL_SECONDS);
      if (outcome.failed) {
        tx.hincrby(bucket, "failures", 1)
          .sadd(`${bucket}:failed-agents`, outcome.payer)
          .expire(`${bucket}:failed-agents`, KEY_TTL_SECONDS);
      }
      resultsOf(await tx.exec());
    },

    async read(now) {
      const minutes = windowMinutes(now);
      const seenRead = redis.pipeline();
      for (const minute of minutes) seenRead.smembers(templatesKey(minute));
      const seen = resultsOf(await seenRead.exec());
      const cells = minutes.flatMap((minute, i) =>
        strings(seen[i]).map((templateId) => ({ minute, templateId })),
      );
      const read = redis.pipeline();
      for (const { minute, templateId } of cells) {
        const bucket = bucketKey(minute, templateId);
        read
          .hmget(bucket, "calls", "failures")
          .smembers(`${bucket}:agents`)
          .smembers(`${bucket}:failed-agents`);
      }
      const values = cells.length > 0 ? resultsOf(await read.exec()) : [];
      const window = new Map<string, WindowBucket[]>();
      cells.forEach(({ templateId }, i) => {
        const [calls, failures] = values[i * 3] as (string | null)[];
        const buckets = window.get(templateId) ?? [];
        buckets.push({
          calls: Number(calls ?? 0),
          failures: Number(failures ?? 0),
          agents: strings(values[i * 3 + 1]),
          failedAgents: strings(values[i * 3 + 2]),
        });
        window.set(templateId, buckets);
      });
      return window;
    },
  };
}
