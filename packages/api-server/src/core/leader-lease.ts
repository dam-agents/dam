import { randomUUID } from "node:crypto";
import type { Redis } from "ioredis";

export interface LeaderLease {
  isLeader(): boolean;
  start(): Promise<void>;
  stop(): Promise<void>;
}

const EXTEND = `
if redis.call("GET", KEYS[1]) == ARGV[1] then
  return redis.call("PEXPIRE", KEYS[1], ARGV[2])
end
return 0
`;

export function createLeaderLease(opts: {
  redis: Redis;
  name: string;
  ttlMs?: number;
  onAcquired: () => Promise<void> | void;
  onLost: () => Promise<void> | void;
  log?: (msg: string) => void;
}): LeaderLease {
  const ttlMs = opts.ttlMs ?? 30_000;
  const key = `leader:${opts.name}`;
  const id = randomUUID();
  const log =
    opts.log ?? ((m: string) => process.stderr.write(`[leader-lease] ${m}\n`));

  let held = false;
  let timer: NodeJS.Timeout | null = null;
  let transition: Promise<void> = Promise.resolve();

  const releaseKey = () =>
    opts.redis
      .eval(
        `if redis.call("GET", KEYS[1]) == ARGV[1] then return redis.call("DEL", KEYS[1]) end return 0`,
        1,
        key,
        id,
      )
      .catch(() => {});

  const transitionTo = (next: boolean) => {
    transition = transition.then(async () => {
      if (held === next) return;
      held = next;
      try {
        await (next ? opts.onAcquired() : opts.onLost());
      } catch (err) {
        log(`${next ? "acquire" : "release"} handler failed: ${err}`);
        if (next) {
          held = false;
          try {
            await opts.onLost();
          } catch (lostErr) {
            log(`release handler failed: ${lostErr}`);
          }
          await releaseKey();
        } else {
          try {
            await opts.onLost();
          } catch (retryErr) {
            log(`release handler retry failed: ${retryErr}`);
          }
        }
      }
    });
    return transition;
  };

  let campaignFailures = 0;

  async function campaign(): Promise<void> {
    try {
      if (held) {
        const extended = await opts.redis.eval(
          EXTEND,
          1,
          key,
          id,
          String(ttlMs),
        );
        campaignFailures = 0;
        if (extended === 0) {
          log(`lease ${opts.name} lost`);
          await transitionTo(false);
        }
        return;
      }
      const won = await opts.redis.set(key, id, "PX", ttlMs, "NX");
      campaignFailures = 0;
      if (won === "OK") {
        log(`lease ${opts.name} acquired`);
        await transitionTo(true);
      }
    } catch (err) {
      campaignFailures += 1;
      log(`campaign failed: ${err}`);
      if (held && campaignFailures >= 2) {
        await transitionTo(false);
        await releaseKey();
      }
    }
  }

  return {
    isLeader: () => held,

    async start() {
      await campaign();
      timer = setInterval(() => void campaign(), Math.floor(ttlMs / 3));
      timer.unref?.();
    },

    async stop() {
      if (timer) clearInterval(timer);
      timer = null;
      const wasHeld = held;
      await transitionTo(false);
      if (wasHeld) await releaseKey();
    },
  };
}
