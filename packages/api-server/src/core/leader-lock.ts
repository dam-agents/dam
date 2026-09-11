import type { DbSql } from "db";

/**
 * UNIT_BOUNDARY_DESCRIPTION: Elects one node to run the work that admits a
 * single holder install-wide — the channel transports, which answer once per
 * install or not at all, the agent watch, and the scheduler that decides where
 * an agent runs. Everything else is already safe to run everywhere: the
 * periodic jobs are scheduled through Redis and delivered to one worker,
 * and the sweeps that are not either take an advisory lock of their own or
 * settle on a conditional update.
 *
 * The lock is a Postgres session advisory lock on a connection reserved for
 * nothing else. That is the whole reason to use one rather than a row with a
 * lease: it is released by the connection ending, so a node that is killed,
 * partitioned or paused stops being the leader without anyone having to decide
 * how long to wait. The cost is that leadership is only as available as
 * Postgres — which is no cost at all here, because there is nothing to lead
 * without it.
 *
 * A node that loses the lock must stand its singletons down before another
 * node picks them up; that is why losing is a callback and not a flag to poll.
 * The key is one arbitrary constant every node shares — holding it is the
 * whole election, so there is nothing else to agree on.
 */
export interface LeaderLock {
  start(): void;
  stop(): Promise<void>;
  isLeader(): boolean;
}

export interface LeaderLockOpts {
  sql: DbSql;
  key: number;
  onAcquired: () => void | Promise<void>;
  onLost: () => void | Promise<void>;
  pollMs?: number;
  log: (message: string, fields?: Record<string, unknown>) => void;
}

const DEFAULT_POLL_MS = 5_000;

export function createLeaderLock(opts: LeaderLockOpts): LeaderLock {
  const pollMs = opts.pollMs ?? DEFAULT_POLL_MS;
  let reserved: Awaited<ReturnType<DbSql["reserve"]>> | null = null;
  let leader = false;
  let timer: NodeJS.Timeout | null = null;
  let stopped = false;

  async function release(): Promise<void> {
    const held = leader;
    leader = false;
    try {
      reserved?.release();
    } catch {
      // the connection is already gone, which is exactly why we lost it
    }
    reserved = null;
    if (held) {
      opts.log("leader.lost");
      await opts.onLost();
    }
  }

  async function tick(): Promise<void> {
    if (stopped) return;
    try {
      if (leader) {
        // The lock lives on this connection, so proving the connection is
        // alive is the same thing as proving we still hold it.
        await reserved!`SELECT 1`;
        return;
      }
      reserved ??= await opts.sql.reserve();
      const rows =
        await reserved`SELECT pg_try_advisory_lock(${opts.key}::bigint) AS ok`;
      if (rows[0]?.ok !== true) return;
      leader = true;
      opts.log("leader.acquired");
      await opts.onAcquired();
    } catch (err) {
      opts.log("leader.tick.failed", {
        error: err instanceof Error ? err.message : String(err),
      });
      await release();
    }
  }

  return {
    start(): void {
      if (timer) return;
      timer = setInterval(() => void tick(), pollMs);
      timer.unref();
      void tick();
    },

    async stop(): Promise<void> {
      stopped = true;
      if (timer) clearInterval(timer);
      timer = null;
      await release();
    },

    isLeader: () => leader,
  };
}
