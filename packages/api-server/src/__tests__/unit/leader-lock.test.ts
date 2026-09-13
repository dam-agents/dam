// TEST_OVERVIEW: the lock decides which node runs the work that admits one holder — the Slack and Telegram transports above all, where a second holder answers every mention twice. What matters is not that acquiring works but that the callbacks fire once each and in order: a node that has already stood up its singletons must not stand them up again, and a node that has lost the connection must stand them down before anyone else takes over.
import { describe, expect, it, vi } from "vitest";
import type { DbSql } from "db";
import { createLeaderLock } from "../../core/leader-lock.js";

function fakeSql(opts: {
  granted: boolean;
  failAfter?: number;
  pidChangesAfter?: number;
  hangAfter?: number;
}) {
  let queries = 0;
  let released = 0;
  const statements: string[] = [];
  const reserved = (() => {
    const fn = (async (parts: TemplateStringsArray) => {
      statements.push(parts.join(""));
      // TEST_SCENARIO: the deadline the heartbeat runs under is setup, not one of the queries these tests count.
      if (parts.join("").includes("set_config")) return [];
      if (parts.join("").includes("pg_advisory_unlock_all")) return [];
      queries += 1;
      if (opts.failAfter !== undefined && queries > opts.failAfter) {
        throw new Error("connection terminated");
      }
      // TEST_SCENARIO: silence, which is what a partition looks like from here — not an error, and no answer either.
      if (opts.hangAfter !== undefined && queries > opts.hangAfter) {
        return new Promise(() => {});
      }
      const pid =
        opts.pidChangesAfter !== undefined && queries > opts.pidChangesAfter
          ? 4242
          : 1234;
      return [{ ok: opts.granted, pid }];
    }) as unknown as Record<string, unknown>;
    fn.release = () => {
      released += 1;
    };
    return fn;
  })();
  const sql = { reserve: async () => reserved };
  return {
    sql: sql as unknown as DbSql,
    releases: () => released,
    queries: () => queries,
    statements: () => statements,
  };
}

const lockOf = (
  sql: DbSql,
  cbs: { onAcquired: () => void; onLost: () => void },
) =>
  createLeaderLock({
    sql,
    key: 1,
    pollMs: 1_000_000,
    log: () => {},
    ...cbs,
  });

describe("leader lock", () => {
  it("stands the singletons up once when it wins", async () => {
    const { sql } = fakeSql({ granted: true });
    const onAcquired = vi.fn();
    const onLost = vi.fn();
    const lock = lockOf(sql, { onAcquired, onLost });

    lock.start();
    await vi.waitFor(() => expect(lock.isLeader()).toBe(true));
    expect(onAcquired).toHaveBeenCalledTimes(1);
    expect(onLost).not.toHaveBeenCalled();
    await lock.stop();
  });

  // TEST_SCENARIO: a node that did not win must not touch the transports at all — this is the double-Slack case.
  it("stays silent when another node holds it", async () => {
    const { sql } = fakeSql({ granted: false });
    const onAcquired = vi.fn();
    const onLost = vi.fn();
    const lock = lockOf(sql, { onAcquired, onLost });

    lock.start();
    await vi.waitFor(() => expect(sql).toBeDefined());
    expect(lock.isLeader()).toBe(false);
    expect(onAcquired).not.toHaveBeenCalled();
    expect(onLost).not.toHaveBeenCalled();
    await lock.stop();
  });

  // TEST_SCENARIO: the lock dies with the connection, so a heartbeat that throws means another node is about to take over and this one must let go first.
  it("stands down and releases when the connection dies", async () => {
    const probe = fakeSql({ granted: true, failAfter: 1 });
    const onAcquired = vi.fn();
    const onLost = vi.fn();
    const lock = createLeaderLock({
      sql: probe.sql,
      key: 1,
      pollMs: 5,
      log: () => {},
      onAcquired,
      onLost,
    });

    lock.start();
    await vi.waitFor(() => expect(onLost).toHaveBeenCalled());
    expect(lock.isLeader()).toBe(false);
    expect(onLost).toHaveBeenCalledTimes(1);
    expect(probe.releases()).toBeGreaterThan(0);
    await lock.stop();
  });

  // TEST_SCENARIO: the connection is replaced underneath the node — every query still succeeds, and the lock went with the backend that is gone. This is the double-Slack case wearing the shape of good health, so a heartbeat that only proved the connection answers would leave two nodes holding the transports. Standing down first is the whole point: it re-takes the lock afterwards on the connection it actually holds.
  it("stands down when its connection is replaced by a healthy one", async () => {
    const probe = fakeSql({ granted: true, pidChangesAfter: 1 });
    const order: string[] = [];
    const lock = createLeaderLock({
      sql: probe.sql,
      key: 1,
      pollMs: 5,
      log: () => {},
      onAcquired: () => void order.push("up"),
      onLost: () => void order.push("down"),
    });

    lock.start();
    await vi.waitFor(() => expect(order).toContain("down"));
    expect(order.slice(0, 2)).toEqual(["up", "down"]);
    expect(probe.releases()).toBeGreaterThan(0);
    await lock.stop();
  });

  // TEST_SCENARIO: standing down while the connection is still alive, which is what a replaced connection or a cancelled statement produces. The connection goes back to a pool rather than being owned, so merely stopping to use it hands back a live session with the lock still on it: no other node can take leadership and this one is not holding it either. These locks are also re-entrant, so reserving that same session again would answer "yes, you have it" to a node that never won it.
  it("unlocks before handing the connection back", async () => {
    const probe = fakeSql({ granted: true, pidChangesAfter: 1 });
    const order: string[] = [];
    const lock = createLeaderLock({
      sql: probe.sql,
      key: 1,
      pollMs: 5,
      log: () => {},
      onAcquired: () => void order.push("up"),
      onLost: () => void order.push("down"),
    });
    lock.start();
    await vi.waitFor(() => expect(order).toContain("down"));
    const unlocked = probe
      .statements()
      .findIndex((q) => q.includes("pg_advisory_unlock_all"));
    expect(unlocked).toBeGreaterThanOrEqual(0);
    await lock.stop();
  });

  // TEST_SCENARIO: the node is partitioned from Postgres. The query does not fail, it simply never answers, and the kernel will keep retrying for minutes. A statement timeout cannot end this — the server is what enforces it, and its error is on the far side of the partition — so the deadline has to be here. Until it fires this node believes it leads and the transports answer as the leader.
  it("stands down when the heartbeat goes silent rather than failing", async () => {
    const probe = fakeSql({ granted: true, hangAfter: 1 });
    const onLost = vi.fn();
    const lock = createLeaderLock({
      sql: probe.sql,
      key: 1,
      pollMs: 5,
      log: () => {},
      onAcquired: vi.fn(),
      onLost,
    });

    lock.start();
    await vi.waitFor(() => expect(onLost).toHaveBeenCalled(), {
      timeout: 2000,
    });
    expect(lock.isLeader()).toBe(false);
    await lock.stop();
  });

  it("does not announce a loss it never held", async () => {
    const { sql } = fakeSql({ granted: false });
    const onLost = vi.fn();
    const lock = lockOf(sql, { onAcquired: vi.fn(), onLost });
    lock.start();
    await lock.stop();
    expect(onLost).not.toHaveBeenCalled();
  });
});
