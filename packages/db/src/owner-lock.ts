import postgres from "postgres";
import { postgresOptions, type DbTlsOptions } from "./client.js";

export type LockOutcome<T> = { ran: true; value: T } | { ran: false };

export interface OwnerLock {
  withLock<T>(owner: string, work: () => Promise<T>): Promise<LockOutcome<T>>;
  stop(): Promise<void>;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: Serializes work per owner across every api-server
 * replica with a session-level advisory lock, taken on a connection of its own
 * so the shared pool never waits on the holder. A caller that finds the lock
 * taken returns at once instead of queuing: the holder is already doing that
 * owner's work, and the next request retries. The lock is released two ways —
 * on the way out, and when the connection drops — so a worker paused or killed
 * while holding it blocks only that owner, and only until Postgres notices.
 */
export function createOwnerLock(deps: {
  url: string;
  tls?: DbTlsOptions | undefined;
  namespace: number;
  max?: number;
}): OwnerLock {
  const sql = postgres(deps.url, postgresOptions(deps.max ?? 8, deps.tls));
  return {
    async withLock(owner, work) {
      const conn = await sql.reserve();
      try {
        const [row] = await conn<{ locked: boolean }[]>`
          select pg_try_advisory_lock(${deps.namespace}, hashtext(${owner})) as locked
        `;
        if (row?.locked !== true) return { ran: false };
        try {
          return { ran: true, value: await work() };
        } finally {
          await conn`
            select pg_advisory_unlock(${deps.namespace}, hashtext(${owner}))
          `;
        }
      } finally {
        conn.release();
      }
    },
    stop: () => sql.end({ timeout: 5 }),
  };
}
