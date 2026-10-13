import type { Redis } from "ioredis";
import { match } from "ts-pattern";
import type { DayCounter } from "../domain/ledger.js";

export interface DayCounters {
  addIfPresent(counter: DayCounter, deltaMicros: number): Promise<boolean>;
  setIfMissing(counter: DayCounter, totalMicros: number): Promise<void>;
  drop(counter: DayCounter): Promise<void>;
}

const COUNTER_TTL_SECONDS = 48 * 60 * 60;

const ADD_IF_PRESENT_SCRIPT = `
if redis.call('EXISTS', KEYS[1]) == 0 then return 0 end
redis.call('INCRBY', KEYS[1], ARGV[1])
return 1
`;

function counterKey(counter: DayCounter): string {
  return match(counter)
    .with(
      { scope: "agent" },
      (c) => `spend:${c.day}:agent:${c.agentId}:${c.unit}`,
    )
    .with(
      { scope: "owner" },
      (c) => `spend:${c.day}:owner:${c.ownerSub}:${c.unit}`,
    )
    .with(
      { scope: "connection" },
      (c) => `spend:${c.day}:conn:${c.agentId}:${c.connectionId}`,
    )
    .exhaustive();
}

export function createRedisDayCounters(redis: Redis): DayCounters {
  return {
    async addIfPresent(counter, deltaMicros) {
      const added = await redis.eval(
        ADD_IF_PRESENT_SCRIPT,
        1,
        counterKey(counter),
        String(deltaMicros),
      );
      return added === 1;
    },

    async setIfMissing(counter, totalMicros) {
      await redis.set(
        counterKey(counter),
        String(totalMicros),
        "EX",
        COUNTER_TTL_SECONDS,
        "NX",
      );
    },

    async drop(counter) {
      await redis.del(counterKey(counter));
    },
  };
}
