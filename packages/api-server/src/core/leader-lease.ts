import { randomUUID } from "node:crypto";
import type { Redis } from "ioredis";

/**
 * Single-holder lease over Redis, for work that must run on exactly one
 * replica rather than once per period (which is {@link ./periodic-jobs.js}'s
 * job). The channel workers need this: Slack Socket Mode fans each event out
 * to one of the open connections and Telegram's `getUpdates` admits only one
 * consumer per token, so a worker per replica splits one conversation's
 * traffic across processes that cannot see each other's turn state.
 *
 * `SET key <id> NX PX ttl` acquires; a heartbeat at `ttl/3` extends it while
 * held. Extension is compare-and-set (Lua) so a replica that stalled past the
 * TTL and lost the lease cannot steal it back from the new holder. A crashed
 * holder's lease expires and another replica picks it up within one TTL.
 *
 * Not fenced: between a stalled holder's last heartbeat and its `onLost`, two
 * replicas can believe they hold the lease. Callers must tolerate a brief
 * overlap — for the channel workers that means at worst a duplicate Slack
 * socket for a few seconds, which Slack itself load-balances. Don't use this
 * where an overlap corrupts state.
 */
export interface LeaderLease {
  /** True while this replica believes it holds the lease. */
  isLeader(): boolean;
  /** Begin campaigning. Resolves once the first acquisition attempt settles
   *  (whether or not it won), so boot ordering is deterministic. */
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
  /** Lease name; becomes the Redis key `leader:<name>`. */
  name: string;
  ttlMs?: number;
  /** Called when this replica takes the lease (never re-entered while held). */
  onAcquired: () => Promise<void> | void;
  /** Called when this replica loses a lease it held — expiry, a failed
   *  extend, or {@link LeaderLease.stop}. Must tear down whatever
   *  `onAcquired` started. */
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
  // Serializes onAcquired/onLost against each other: a lease lost while its
  // onAcquired still runs must tear down only after that finished, or the
  // teardown races a half-built Slack socket.
  let transition: Promise<void> = Promise.resolve();

  const transitionTo = (next: boolean) => {
    transition = transition.then(async () => {
      if (held === next) return;
      held = next;
      try {
        await (next ? opts.onAcquired() : opts.onLost());
      } catch (err) {
        log(`${next ? "acquire" : "release"} handler failed: ${err}`);
      }
    });
    return transition;
  };

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
        // Lost it — expired while we stalled, or someone else holds it now.
        if (extended === 0) {
          log(`lease ${opts.name} lost`);
          await transitionTo(false);
        }
        return;
      }
      const won = await opts.redis.set(key, id, "PX", ttlMs, "NX");
      if (won === "OK") {
        log(`lease ${opts.name} acquired`);
        await transitionTo(true);
      }
    } catch (err) {
      // Redis unreachable. Standing down is the safe read: a partitioned
      // replica must not keep acting as leader while another replica, which
      // can still see Redis, takes over.
      log(`campaign failed: ${err}`);
      if (held) await transitionTo(false);
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
      // Hand the lease over immediately instead of making the next replica
      // wait out the TTL. Compare-and-set: never delete a lease we no
      // longer own.
      if (wasHeld) {
        await opts.redis
          .eval(
            `if redis.call("GET", KEYS[1]) == ARGV[1] then return redis.call("DEL", KEYS[1]) end return 0`,
            1,
            key,
            id,
          )
          .catch(() => {});
      }
    },
  };
}
