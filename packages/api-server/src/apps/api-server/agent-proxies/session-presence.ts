import { randomUUID } from "node:crypto";
import type { Redis } from "ioredis";
import { ACTIVE_SESSION_KEY } from "../../../modules/agents/infrastructure/labels.js";
import { SESSION_PRESENCE_KEY_PREFIX } from "../../../core/turn-attendance.js";

const KEY_PREFIX = SESSION_PRESENCE_KEY_PREFIX;
const KEY_TTL_SECONDS = 90;
const HEARTBEAT_MS = 30_000;

export interface SessionPresence {
  acquire(agentId: string): () => void;
  reconcile(): Promise<void>;
  close(): void;
}

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
              set(agentId, false);
            });
        }
      };
    },

    async reconcile() {
      const active = await scanAgentIds(`${KEY_PREFIX}*`);
      if (active.size === 0 && open.size > 0) return;
      const annotated = await repo.listAgentIdsWithAnnotation(
        ACTIVE_SESSION_KEY,
        "true",
      );
      for (const agentId of annotated) {
        if (active.has(agentId)) continue;
        if (await anyReplicaHolds(agentId)) continue;
        await set(agentId, false);
      }
    },

    close() {
      clearInterval(heartbeat);
    },
  };
}
