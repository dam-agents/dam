import { describe, it, expect, vi } from "vitest";
import type { Redis } from "ioredis";
import {
  createTurnAttendance,
  SESSION_PRESENCE_KEY_PREFIX,
} from "../../core/turn-attendance.js";

/** Minimal in-memory stand-in for the two commands the store uses, plus a
 *  cursor-walking SCAN so the reader's pagination is exercised rather than
 *  short-circuited by a single-page fake. */
function makeFakeRedis(opts?: { failScan?: boolean }) {
  const keys = new Set<string>();
  const redis = {
    set: vi.fn(async (key: string) => {
      keys.add(key);
      return "OK";
    }),
    del: vi.fn(async (key: string) => {
      keys.delete(key);
      return 1;
    }),
    scan: vi.fn(async (cursor: string, _m: string, pattern: string) => {
      if (opts?.failScan) throw new Error("redis down");
      const re = new RegExp(`^${pattern.replace("*", ".*")}$`);
      const all = [...keys];
      // Hand back one key per page so a match on a later page still counts.
      const i = Number(cursor);
      const next = i + 1 >= all.length ? "0" : String(i + 1);
      const page = all[i] !== undefined && re.test(all[i]!) ? [all[i]!] : [];
      return [next, page] as [string, string[]];
    }),
  };
  return { redis: redis as unknown as Redis, keys, spies: redis };
}

/** Lets the fire-and-forget write chain settle. */
async function flush(): Promise<void> {
  for (let i = 0; i < 20; i++) await Promise.resolve();
}

describe("turn attendance", () => {
  it("marks a channel turn open and clears it on release", async () => {
    const { redis, keys } = makeFakeRedis();
    const attendance = createTurnAttendance(redis);

    const release = attendance.openChannelTurn("agent-1");
    await flush();
    expect(
      [...keys].some((k) => k.startsWith("channel-turn:agent:agent-1:")),
    ).toBe(true);

    release();
    await flush();
    expect([...keys]).toHaveLength(0);
    attendance.close();
  });

  it("keeps the marker until the last of several concurrent turns ends", async () => {
    const { redis, keys } = makeFakeRedis();
    const attendance = createTurnAttendance(redis);

    const first = attendance.openChannelTurn("agent-1");
    const second = attendance.openChannelTurn("agent-1");
    await flush();

    first();
    await flush();
    expect(keys.size).toBe(1);

    second();
    await flush();
    expect(keys.size).toBe(0);
    attendance.close();
  });

  it("ignores a repeated release so one turn can't drop another's marker", async () => {
    const { redis, keys } = makeFakeRedis();
    const attendance = createTurnAttendance(redis);

    const first = attendance.openChannelTurn("agent-1");
    const second = attendance.openChannelTurn("agent-1");
    await flush();

    first();
    first();
    first();
    await flush();
    expect(keys.size).toBe(1);

    second();
    await flush();
    expect(keys.size).toBe(0);
    attendance.close();
  });

  it("sees a turn held by another replica", async () => {
    const { redis, keys } = makeFakeRedis();
    const attendance = createTurnAttendance(redis);

    // Written by a different replica id than this instance's.
    keys.add("channel-turn:agent:agent-1:other-replica");

    expect(await attendance.hasOpenChannelTurn("agent-1")).toBe(true);
    expect(await attendance.hasOpenChannelTurn("agent-2")).toBe(false);
    attendance.close();
  });

  it("reads its own open turn without a round trip", async () => {
    const { redis, spies } = makeFakeRedis();
    const attendance = createTurnAttendance(redis);

    attendance.openChannelTurn("agent-1");
    expect(await attendance.hasOpenChannelTurn("agent-1")).toBe(true);
    expect(spies.scan).not.toHaveBeenCalled();
    attendance.close();
  });

  it("reports an interactive session from the relays' presence keys", async () => {
    const { redis, keys } = makeFakeRedis();
    const attendance = createTurnAttendance(redis);

    expect(await attendance.hasInteractiveSession("agent-1")).toBe(false);
    keys.add(`${SESSION_PRESENCE_KEY_PREFIX}agent-1:some-replica`);
    expect(await attendance.hasInteractiveSession("agent-1")).toBe(true);
    attendance.close();
  });

  it("fails toward holding when Redis is unreachable", async () => {
    const { redis } = makeFakeRedis({ failScan: true });
    const attendance = createTurnAttendance(redis);

    // Both answers must push the gate onto the ordinary hold path rather than
    // a fast deny: no channel turn known, and assume someone is watching.
    expect(await attendance.hasOpenChannelTurn("agent-1")).toBe(false);
    expect(await attendance.hasInteractiveSession("agent-1")).toBe(true);
    attendance.close();
  });
});
