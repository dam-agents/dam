import { randomUUID } from "node:crypto";
import type { Redis } from "ioredis";
import type { RefusedIn } from "api-server-api";

export const SESSION_PRESENCE_KEY_PREFIX = "presence:agent:";

const CHANNEL_TURN_KEY_PREFIX = "channel-turn:agent:";
const ADDRESSED_TURN_KEY_PREFIX = "addressed-turn:agent:";
const RELEASED_TURN_KEY_PREFIX = "released-turn:agent:";

const KEY_TTL_SECONDS = 90;
const HEARTBEAT_MS = 30_000;

export type ChannelTurnKind = "slack" | "telegram" | "artifact";

export interface ChannelTurnOpening {
  channel: ChannelTurnKind;
  addressed: boolean;
}

export type ChannelTurnHandle = () => void;

export interface ChannelTurnAttendance {
  openChannelTurn(agentId: string, turn: ChannelTurnOpening): ChannelTurnHandle;
  releaseAddressed(handle: ChannelTurnHandle): Promise<void>;
}

export interface TurnAttendance extends ChannelTurnAttendance {
  hasOpenChannelTurn(agentId: string): Promise<boolean>;
  channelTurnKinds(agentId: string): Promise<readonly RefusedIn[]>;
  hasAddressedTurn(agentId: string): Promise<boolean>;
  hasReleasedTurn(agentId: string): Promise<boolean>;
  hasInteractiveSession(agentId: string): Promise<boolean>;
  close(): void;
}

interface OpenTurn {
  readonly agentId: string;
  readonly channelKey: string;
  addressed: boolean;
  released: boolean;
  ended: boolean;
}

const CHANNEL_TURN_KINDS: readonly ChannelTurnKind[] = [
  "slack",
  "telegram",
  "artifact",
];

function kindOfKey(key: string, agentId: string): RefusedIn {
  const rest = key.slice(`${CHANNEL_TURN_KEY_PREFIX}${agentId}:`.length);
  const kind = rest.slice(rest.indexOf(":") + 1);
  return rest.includes(":") &&
    (CHANNEL_TURN_KINDS as readonly string[]).includes(kind)
    ? (kind as ChannelTurnKind)
    : "unknown";
}

// UNIT_BOUNDARY_DESCRIPTION: which channel turns are open on an agent, across api-server replicas. Each replica counts its own open turns per Redis key and writes the key when its count leaves zero, deletes it when the count returns to zero, and refreshes it every thirty seconds, so a replica that dies drops out after ninety. Three counts exist per agent: every channel turn with its kind (Slack, Telegram or an artifact's viewer), the addressed Slack turns (a person's message on a turn that shows the working status), and the Slack turns whose person pressed "Don't wait". A release moves a turn from the addressed count to the released count and resolves only after Redis has both changes, so a request the agent sends next already finds the turn released. A key that an older replica wrote has no kind, and it reads as a channel turn of an unknown kind, never as an addressed one.
export function createTurnAttendance(redis: Redis): TurnAttendance {
  const replicaId = randomUUID();
  const counts = new Map<string, number>();
  const turns = new WeakMap<ChannelTurnHandle, OpenTurn>();
  const channelKey = (agentId: string, kind: ChannelTurnKind) =>
    `${CHANNEL_TURN_KEY_PREFIX}${agentId}:${replicaId}:${kind}`;
  const addressedKey = (agentId: string) =>
    `${ADDRESSED_TURN_KEY_PREFIX}${agentId}:${replicaId}`;
  const releasedKey = (agentId: string) =>
    `${RELEASED_TURN_KEY_PREFIX}${agentId}:${replicaId}`;

  const writes = new Map<string, Promise<unknown>>();
  function chain(key: string, op: () => Promise<unknown>): Promise<void> {
    const prev = writes.get(key) ?? Promise.resolve();
    const next = prev.then(op, op);
    const settled = next.then(
      () => {},
      () => {},
    );
    writes.set(key, settled);
    void settled.then(() => {
      if (writes.get(key) === settled) writes.delete(key);
    });
    return next.then(() => {});
  }

  function countUp(key: string): Promise<void> {
    const before = counts.get(key) ?? 0;
    counts.set(key, before + 1);
    return before === 0
      ? chain(key, () => redis.set(key, "1", "EX", KEY_TTL_SECONDS))
      : Promise.resolve();
  }

  function countDown(key: string): Promise<void> {
    const left = (counts.get(key) ?? 1) - 1;
    if (left > 0) {
      counts.set(key, left);
      return Promise.resolve();
    }
    counts.delete(key);
    return chain(key, () => redis.del(key));
  }

  async function keysMatching(pattern: string): Promise<string[]> {
    const found: string[] = [];
    let cursor = "0";
    do {
      const [next, keys] = await redis.scan(
        cursor,
        "MATCH",
        pattern,
        "COUNT",
        500,
      );
      found.push(...keys);
      cursor = next;
    } while (cursor !== "0");
    return found;
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

  const counted = (prefix: string, agentId: string) =>
    [...counts.keys()].some((key) => key.startsWith(`${prefix}${agentId}:`));

  async function anyCounted(prefix: string, agentId: string) {
    if (counted(prefix, agentId)) return true;
    try {
      return await anyKeyMatching(`${prefix}${agentId}:*`);
    } catch {
      return false;
    }
  }

  const heartbeat = setInterval(() => {
    for (const key of counts.keys()) {
      void chain(key, () => redis.set(key, "1", "EX", KEY_TTL_SECONDS)).catch(
        () => {},
      );
    }
  }, HEARTBEAT_MS);
  heartbeat.unref?.();

  return {
    openChannelTurn(agentId, { channel, addressed }) {
      const turn: OpenTurn = {
        agentId,
        channelKey: channelKey(agentId, channel),
        addressed,
        released: false,
        ended: false,
      };
      void countUp(turn.channelKey).catch(() => {});
      if (addressed) void countUp(addressedKey(agentId)).catch(() => {});

      const handle: ChannelTurnHandle = () => {
        if (turn.ended) return;
        turn.ended = true;
        void countDown(turn.channelKey).catch(() => {});
        if (turn.addressed)
          void countDown(addressedKey(agentId)).catch(() => {});
        if (turn.released) void countDown(releasedKey(agentId)).catch(() => {});
      };
      turns.set(handle, turn);
      return handle;
    },

    async releaseAddressed(handle) {
      const turn = turns.get(handle);
      if (!turn || turn.ended || !turn.addressed) return;
      turn.addressed = false;
      turn.released = true;
      await Promise.all([
        countUp(releasedKey(turn.agentId)),
        countDown(addressedKey(turn.agentId)),
      ]);
    },

    async hasOpenChannelTurn(agentId) {
      return anyCounted(CHANNEL_TURN_KEY_PREFIX, agentId);
    },

    async channelTurnKinds(agentId) {
      const local = [...counts.keys()].filter((key) =>
        key.startsWith(`${CHANNEL_TURN_KEY_PREFIX}${agentId}:`),
      );
      const remote = await keysMatching(
        `${CHANNEL_TURN_KEY_PREFIX}${agentId}:*`,
      ).catch(() => []);
      return [
        ...new Set([...local, ...remote].map((key) => kindOfKey(key, agentId))),
      ];
    },

    async hasAddressedTurn(agentId) {
      return anyCounted(ADDRESSED_TURN_KEY_PREFIX, agentId);
    },

    async hasReleasedTurn(agentId) {
      return anyCounted(RELEASED_TURN_KEY_PREFIX, agentId);
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
