import { randomUUID } from "node:crypto";
import type { Redis } from "ioredis";

export const SESSION_PRESENCE_KEY_PREFIX = "presence:agent:";

const CHANNEL_TURN_KEY_PREFIX = "channel-turn:agent:";

const KEY_TTL_SECONDS = 90;
const HEARTBEAT_MS = 30_000;

export interface ChannelTurnAttendance {
  openChannelTurn(agentId: string): () => void;
}

export interface TurnAttendance extends ChannelTurnAttendance {
  hasOpenChannelTurn(agentId: string): Promise<boolean>;
  hasInteractiveSession(agentId: string): Promise<boolean>;
  close(): void;
}

export function createTurnAttendance(redis: Redis): TurnAttendance {
  const replicaId = randomUUID();
  const open = new Map<string, number>();
  const key = (agentId: string) =>
    `${CHANNEL_TURN_KEY_PREFIX}${agentId}:${replicaId}`;

  const writes = new Map<string, Promise<unknown>>();
  function chain(agentId: string, op: () => Promise<unknown>): void {
    const prev = writes.get(agentId) ?? Promise.resolve();
    const next = prev.then(op, op).catch(() => {});
    writes.set(agentId, next);
    void next.then(() => {
      if (writes.get(agentId) === next) writes.delete(agentId);
    });
  }

  async function anyKeyMatching(pattern: string): Promise<boolean> {
    let cursor = "0";
    do {
      const [next, keys] = await redis.scan(
        cursor,
        "MATCH",
        pattern,
        "COUNT",
        500,
      );
      if (keys.length > 0) return true;
      cursor = next;
    } while (cursor !== "0");
    return false;
  }

  const heartbeat = setInterval(() => {
    for (const agentId of open.keys()) {
      chain(agentId, () => redis.set(key(agentId), "1", "EX", KEY_TTL_SECONDS));
    }
  }, HEARTBEAT_MS);
  heartbeat.unref?.();

  return {
    openChannelTurn(agentId) {
      const before = open.get(agentId) ?? 0;
      open.set(agentId, before + 1);
      if (before === 0) {
        chain(agentId, () =>
          redis.set(key(agentId), "1", "EX", KEY_TTL_SECONDS),
        );
      }

      let released = false;
      return () => {
        if (released) return;
        released = true;
        const n = (open.get(agentId) ?? 1) - 1;
        if (n > 0) {
          open.set(agentId, n);
          return;
        }
        open.delete(agentId);
        chain(agentId, () => redis.del(key(agentId)));
      };
    },

    async hasOpenChannelTurn(agentId) {
      if (open.has(agentId)) return true;
      try {
        return await anyKeyMatching(`${CHANNEL_TURN_KEY_PREFIX}${agentId}:*`);
      } catch {
        return false;
      }
    },

    async hasInteractiveSession(agentId) {
      try {
        return await anyKeyMatching(
          `${SESSION_PRESENCE_KEY_PREFIX}${agentId}:*`,
        );
      } catch {
        return true;
      }
    },

    close() {
      clearInterval(heartbeat);
    },
  };
}
