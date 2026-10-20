// TEST_OVERVIEW: the one queue every producer of a harness-config event goes through. The event id carries the Agent's dedupe timestamp and the runtime skips an event that is not newer than the last one it ran, so the timestamp is allocated under the outbox row lock and above every harness-config event the Agent already holds — the Config panel and the one-off mode reset cannot queue an event the other would skip. The SQL runs against a real Postgres nowhere in this suite, so these specs pin the statements and their order.
import { describe, it, expect } from "vitest";
import { createDb, type Db } from "db";
import type { OutboxRepo } from "../../modules/runtime-delivery/index.js";
import { EVENT_TTL_MS } from "../../modules/harness-config/domain/harness-config-event.js";
import { createHarnessConfigEventQueue } from "../../modules/harness-config/infrastructure/config-event-queue.js";

type Dialect = { sqlToQuery: (q: never) => { sql: string; params: unknown[] } };

function capturingDb(rows: unknown[][], order: string[]) {
  const probe = createDb("postgresql://unused:unused@127.0.0.1:1/unused");
  const dialect = (probe.db as unknown as { dialect: Dialect }).dialect;
  void probe.sql.end({ timeout: 0 });
  const captured: { sql: string; params: unknown[] }[] = [];
  const execute = (query: unknown) => {
    order.push("read");
    captured.push(dialect.sqlToQuery(query as never));
    return Promise.resolve(rows.shift() ?? []);
  };
  const db = {
    execute,
    transaction: async (run: (tx: unknown) => Promise<unknown>) =>
      run({ execute }),
  } as unknown as Db;
  return { db, captured, execute };
}

function harness(rows: unknown[][], now: number) {
  const order: string[] = [];
  const { db, captured, execute } = capturingDb(rows, order);
  const events: Record<string, unknown>[] = [];
  const outboxRepo = {
    bumpVersion: async () => {
      order.push("bump");
      return 7;
    },
    insertEvent: async (event: Record<string, unknown>) => {
      order.push("insert");
      events.push(event);
    },
  } as unknown as OutboxRepo;
  return {
    queue: createHarnessConfigEventQueue({ db, outboxRepo, now: () => now }),
    captured,
    events,
    order,
    tx: { execute } as unknown as Db,
  };
}

const CHANGE = { harness: "claude-code", mode: "auto" };

describe("harness-config event queue", () => {
  // TEST_SCENARIO: the runtime runs an event only when its timestamp is newer than the last one it ran, so the allocation bumps the outbox row first, reads the newest harness-config event under that lock, then inserts: a clock behind an existing event must not lose the change.
  it("stamps the change newer than the Agent's newest harness-config event", async () => {
    const { queue, captured, events, order } = harness(
      [[{ at: "9000" }]],
      1000,
    );

    const version = await queue.queue("a1", CHANGE);

    expect(order).toEqual(["bump", "read", "insert"]);
    expect(captured[0]?.sql).toContain("runtime_events");
    expect(captured[0]?.params).toEqual(["a1"]);
    const event = events[0] as {
      id: string;
      kind: string;
      payload: unknown;
      version: number;
      agentId: string;
      expiresAt: Date;
    };
    expect(event).toMatchObject({
      id: "harness-config:a1:9001",
      kind: "harness-config",
      payload: CHANGE,
      version: 7,
      agentId: "a1",
    });
    expect(version).toBe(7);
    expect(event.expiresAt.getTime()).toBe(9001 + EVENT_TTL_MS);
  });

  // TEST_SCENARIO: with no harness-config event on the Agent the wall clock stamps the change, and one shared TTL bounds it, so a correction cannot outlive an owner's later choice by more than any other queued change.
  it("stamps the change from the clock when the Agent has no event", async () => {
    const { queue, events } = harness([[]], 1000);

    await queue.queue("a1", CHANGE);

    expect(events[0]).toMatchObject({ id: "harness-config:a1:1000" });
  });

  // TEST_SCENARIO: a caller that already holds a transaction — the reset settles an Agent in one — queues on it, so its event commits with its claim and its declaration.
  it("queues on the caller's transaction", async () => {
    const { events, order, tx } = harness([[{ at: "9000" }]], 1000);
    const insertOnTx: unknown[] = [];
    const scoped = {
      queue: createHarnessConfigEventQueue({
        db: {} as Db,
        outboxRepo: {
          bumpVersion: async (agentId: string, scope: unknown) => {
            insertOnTx.push(["bump", agentId, scope]);
            return 3;
          },
          insertEvent: async (
            event: Record<string, unknown>,
            scope: unknown,
          ) => {
            insertOnTx.push(["insert", event.id, scope]);
          },
        } as unknown as OutboxRepo,
        now: () => 1000,
      }),
    };

    await scoped.queue.queue("a1", CHANGE, tx);

    expect(insertOnTx).toEqual([
      ["bump", "a1", tx],
      ["insert", "harness-config:a1:9001", tx],
    ]);
    expect(order).toEqual(["read"]);
    expect(events).toEqual([]);
  });
});
