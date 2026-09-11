// TEST_OVERVIEW: the change stream is what drives reconcile, and on one node it was an in-process emitter — a write on another node was simply invisible. The bridge has to do three things and no more: ignore the notes this node sent itself, re-read the row rather than trusting what came over the wire, and turn a note about a row that is gone into a delete.
import { describe, expect, it, vi } from "vitest";
import type { Db } from "db";
import {
  createAgentStore,
  type AgentChange,
} from "../../modules/agents/infrastructure/agent-store.js";

const ROW = {
  id: "a1",
  owner: "owner-1",
  templateId: null,
  annotations: {},
  spec: { image: "x" },
  status: { ready: true },
  assignedNode: "node-2",
  lastNode: "node-2",
  createdAt: new Date(),
};

function fakeDb(rows: unknown[]) {
  let selects = 0;
  const db = {
    select: () => ({
      from: () => ({
        where: () => {
          selects += 1;
          return Promise.resolve(rows);
        },
      }),
    }),
    update: () => ({
      set: () => ({
        where: () => ({ returning: () => Promise.resolve(rows) }),
      }),
    }),
  };
  return { db: db as unknown as Db, selects: () => selects };
}

function fakeBus() {
  const listeners: ((payload: string) => void)[] = [];
  const published: string[] = [];
  return {
    bus: {
      publish: async (_c: string, payload: string) => {
        published.push(payload);
      },
      subscribe: (_c: string, listener: (payload: string) => void) => {
        listeners.push(listener);
        return () => {};
      },
    },
    deliver: (payload: string) => listeners.forEach((l) => l(payload)),
    published,
  };
}

describe("cross-node change notes", () => {
  it("re-reads the row a note names and emits it locally", async () => {
    const { db, selects } = fakeDb([ROW]);
    const { bus, deliver } = fakeBus();
    const store = createAgentStore(db, bus);
    const seen: AgentChange[] = [];
    store.onChange((c) => seen.push(c));

    deliver(JSON.stringify({ origin: "elsewhere", id: "a1" }));
    await vi.waitFor(() => expect(seen).toHaveLength(1));

    expect(selects()).toBe(1);
    expect(seen[0]).toMatchObject({
      type: "upsert",
      id: "a1",
      record: { assignedNode: "node-2" },
    });
  });

  // TEST_SCENARIO: a node that handled its own note would reconcile every write twice, and the local path is already synchronous.
  it("ignores the notes it sent itself", async () => {
    const { db } = fakeDb([ROW]);
    const { bus, deliver, published } = fakeBus();
    const store = createAgentStore(db, bus);
    const seen: AgentChange[] = [];
    store.onChange((c) => seen.push(c));

    await store.writeStatus("a1", { ready: true }).catch(() => {});
    const own = published.at(-1);
    expect(own).toBeDefined();
    seen.length = 0;

    deliver(own!);
    await new Promise((r) => setTimeout(r, 20));
    expect(seen).toHaveLength(0);
  });

  // TEST_SCENARIO: a note about an agent deleted on another node must reach the supervisor as a delete, or its sandbox is only reaped by the sweep.
  it("turns a note about a missing row into a delete", async () => {
    const { db } = fakeDb([]);
    const { bus, deliver } = fakeBus();
    const store = createAgentStore(db, bus);
    const seen: AgentChange[] = [];
    store.onChange((c) => seen.push(c));

    deliver(JSON.stringify({ origin: "elsewhere", id: "gone" }));
    await vi.waitFor(() => expect(seen).toHaveLength(1));
    expect(seen[0]).toEqual({ type: "delete", id: "gone" });
  });

  it("survives a note that is not a note", async () => {
    const { db } = fakeDb([ROW]);
    const { bus, deliver } = fakeBus();
    const store = createAgentStore(db, bus);
    const seen: AgentChange[] = [];
    store.onChange((c) => seen.push(c));

    deliver("not json");
    deliver(JSON.stringify({ origin: "elsewhere" }));
    await new Promise((r) => setTimeout(r, 20));
    expect(seen).toHaveLength(0);
  });
});
