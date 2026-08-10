import { randomUUID } from "node:crypto";
import type { Redis } from "ioredis";
import { ACTIVE_SESSION_KEY } from "../../modules/agents/infrastructure/labels.js";
import { SESSION_PRESENCE_KEY_PREFIX } from "../../core/turn-attendance.js";

// Shared with the egress gate, which reads these keys to tell whether anyone
// is attached to answer an approval hold.
const KEY_PREFIX = SESSION_PRESENCE_KEY_PREFIX;
// A replica key vanishes this long after the replica stops refreshing it —
// crash, OOM, network partition — so a dead replica's sessions stop pinning
// the agent awake within ~2 minutes (reconcile tick + TTL).
const KEY_TTL_SECONDS = 90;
const HEARTBEAT_MS = 30_000;

export interface SessionPresence {
  acquire(agentId: string): () => void;
  /** Idempotent cross-replica reconciliation: clears the active-session
   *  annotation on agents no replica holds sessions for (covers crashed
   *  replicas whose release never ran). Register as a periodic job. */
  reconcile(): Promise<void>;
  close(): void;
}

/**
 * Tracks open user sessions per agent and mirrors "any session open" onto
 * the agent's `ACTIVE_SESSION_KEY` annotation (the idle checker's pin).
 *
 * Multi-replica: each replica owns one Redis key per agent it holds
 * sessions for (`presence:agent:<agentId>:<replicaId>`), refreshed by a
 * heartbeat while held. "Active" is the union across replicas — release
 * only clears the annotation when no replica key remains, and `reconcile()`
 * sweeps annotations orphaned by a crashed replica (its key expires by
 * TTL). Redis is the signal path only; a Redis outage degrades to
 * per-replica behavior (annotation writes stay best-effort).
 */
export function createSessionPresence(
  repo: {
    patchAnnotation(id: string, key: string, value: string): Promise<void>;
    listAgentIdsWithAnnotation(key: string, value: string): Promise<string[]>;
  },
  redis: Redis,
): SessionPresence {
  const replicaId = randomUUID();
  const open = new Map<string, number>();
  const set = (agentId: string, active: boolean) =>
    repo
      .patchAnnotation(agentId, ACTIVE_SESSION_KEY, active ? "true" : "")
      .catch(() => {});
  const replicaKey = (agentId: string) =>
    `${KEY_PREFIX}${agentId}:${replicaId}`;

  async function scanAgentIds(pattern: string): Promise<Set<string>> {
    const ids = new Set<string>();
    let cursor = "0";
    do {
      const [next, keys] = await redis.scan(
        cursor,
        "MATCH",
        pattern,
        "COUNT",
        500,
      );
      cursor = next;
      for (const key of keys) {
        const rest = key.slice(KEY_PREFIX.length);
        const cut = rest.lastIndexOf(":");
        if (cut > 0) ids.add(rest.slice(0, cut));
      }
    } while (cursor !== "0");
    return ids;
  }

  async function anyReplicaHolds(agentId: string): Promise<boolean> {
    const ids = await scanAgentIds(`${KEY_PREFIX}${agentId}:*`);
    return ids.has(agentId);
  }

  const heartbeat = setInterval(() => {
    for (const agentId of open.keys()) {
      redis
        .set(replicaKey(agentId), "1", "EX", KEY_TTL_SECONDS)
        .catch(() => {});
      // Re-assert the annotation too: acquire()'s single patch is
      // best-effort, and a dropped write would otherwise leave a live
      // session unpinned for its whole duration (reconcile only clears).
      set(agentId, true);
    }
  }, HEARTBEAT_MS);
  heartbeat.unref?.();

  return {
    acquire(agentId) {
      const before = open.get(agentId) ?? 0;
      open.set(agentId, before + 1);
      if (before === 0) {
        redis
          .set(replicaKey(agentId), "1", "EX", KEY_TTL_SECONDS)
          .catch(() => {});
        set(agentId, true);
      }

      let released = false;
      return () => {
        if (released) return;
        released = true;
        const n = (open.get(agentId) ?? 1) - 1;
        if (n > 0) open.set(agentId, n);
        else {
          open.delete(agentId);
          void redis
            .del(replicaKey(agentId))
            .then(() => anyReplicaHolds(agentId))
            .then((held) => {
              if (!held) set(agentId, false);
            })
            .catch(() => {
              // Redis unreachable — clear like the single-replica path did;
              // reconcile() restores truth once Redis is back.
              set(agentId, false);
            });
        }
      };
    },

    async reconcile() {
      const active = await scanAgentIds(`${KEY_PREFIX}*`);
      // Don't trust an empty scan while this replica itself holds sessions —
      // that shape means Redis lost the keys (restart, failover), not that
      // every session everywhere closed. Skip the tick; heartbeats rewrite
      // the keys within 30s and the next tick sweeps for real. A stale pin
      // lingering one more minute beats hibernating a live agent fleet-wide.
      if (active.size === 0 && open.size > 0) return;
      const annotated = await repo.listAgentIdsWithAnnotation(
        ACTIVE_SESSION_KEY,
        "true",
      );
      for (const agentId of annotated) {
        if (active.has(agentId)) continue;
        // Per-agent re-check before the destructive write: bounds the risk
        // of a partial SCAN (cursor walk racing key churn) to agents that
        // read as unheld twice in a row.
        if (await anyReplicaHolds(agentId)) continue;
        await set(agentId, false);
      }
    },

    close() {
      clearInterval(heartbeat);
    },
  };
}
