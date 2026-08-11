import { randomUUID } from "node:crypto";
import type { Redis } from "ioredis";

/** Per-replica session-presence keys (`<prefix><agentId>:<replicaId>`),
 *  written by the ACP/terminal/SSH relays while a browser or CLI client is
 *  attached. Declared here rather than in the relay so the egress gate can
 *  read the same shape without depending on an app module. */
export const SESSION_PRESENCE_KEY_PREFIX = "presence:agent:";

/** Same per-replica shape for channel-driven turns, written by the Slack and
 *  Telegram workers for the length of a turn. */
const CHANNEL_TURN_KEY_PREFIX = "channel-turn:agent:";

// Matches the session-presence heartbeat: a key vanishes this long after its
// replica stops refreshing it, so a crashed replica stops claiming a channel
// turn is open within ~90s rather than for the whole turn ceiling.
const KEY_TTL_SECONDS = 90;
const HEARTBEAT_MS = 30_000;

/**
 * Who is positioned to answer an egress approval for an agent.
 *
 * Two independent facts, both unions across api-server replicas — the replica
 * relaying a channel turn is rarely the one Envoy's ext_authz Check lands on:
 *
 * - **an open channel turn** — a Slack or Telegram turn is driving the agent.
 *   No verdict can be gestured from a messenger, and the conversation's other
 *   participants aren't the owner, so a hold raised by such a turn has nobody
 *   to answer it.
 * - **an attached interactive session** — a browser or CLI is on the agent
 *   over a relay, which *is* somewhere a verdict can be made.
 *
 * Reads fail toward "someone is attending" so a Redis blip degrades to the
 * ordinary hold rather than silently denying an agent's egress.
 */
/** Writer half, consumed by the Slack and Telegram workers. */
export interface ChannelTurnAttendance {
  /** Marks a channel-driven turn open on the agent. Call the returned release
   *  when the turn settles; releases are idempotent and refcounted, so
   *  concurrent turns on one agent hold the marker until the last one ends. */
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

  // Serialize this replica's writes per agent so a turn shorter than its own
  // SET can't have its DEL overtaken and leave the marker stranded for a TTL.
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
      // This replica's own turns are authoritative without a round trip.
      if (open.has(agentId)) return true;
      try {
        return await anyKeyMatching(`${CHANNEL_TURN_KEY_PREFIX}${agentId}:*`);
      } catch {
        // Unknown, not absent — treat as no channel turn so the hold stands.
        return false;
      }
    },

    async hasInteractiveSession(agentId) {
      try {
        return await anyKeyMatching(
          `${SESSION_PRESENCE_KEY_PREFIX}${agentId}:*`,
        );
      } catch {
        // Unknown, not absent — assume someone is watching and hold.
        return true;
      }
    },

    close() {
      clearInterval(heartbeat);
    },
  };
}
