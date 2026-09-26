// TEST_OVERVIEW: processEvents settles exactly the events that ran (or superseded/expired ones) — a transiently failed dispatch must stay pending so the outbox retry re-runs it.
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Event } from "agent-runtime-api";
import { createFileDocumentStoreBackend } from "../../core/document-store.js";
import type { EventDispatcher } from "../../modules/runtime-channel/dispatcher.js";
import { processEvents } from "../../modules/runtime-channel/event-loop.js";
import { createStateStore } from "../../modules/runtime-channel/state-store.js";

function trigger(ts: number, version: number): Event {
  return {
    id: `sched-1:${ts}`,
    kind: "trigger",
    version,
    expiresAt: new Date(Date.now() + 3600_000).toISOString(),
    payload: { scheduleId: "sched-1", task: "do the thing" },
  };
}

describe("runtime-channel event loop", () => {
  let home: string;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "event-loop-"));
    mkdirSync(join(home, ".platform"), { recursive: true });
  });

  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
  });

  const store = () => createStateStore(createFileDocumentStoreBackend(home));

  const dispatcher = (behavior: (calls: number) => void) => {
    let calls = 0;
    return {
      calls: () => calls,
      invoke: async () => {
        calls += 1;
        behavior(calls);
      },
    } satisfies EventDispatcher & { calls: () => number };
  };

  // TEST_SCENARIO: the api-server advances lastAppliedVersion when only an event dispatch failed; the redelivery must still run the event, not settle it unrun.
  it("re-runs a failed event on redelivery even after the applied version advanced", async () => {
    const s = store();
    const d = dispatcher((n) => {
      if (n === 1) throw new Error("transient");
    });

    const first = await processEvents([trigger(1000, 6)], d, s, () => {});
    expect(first).toEqual([]);

    s.write({ ...s.read(), lastAppliedVersion: 6 });

    const retry = await processEvents([trigger(1000, 6)], d, s, () => {});
    expect(retry).toEqual(["sched-1:1000"]);
    expect(d.calls()).toBe(2);
  });

  it("settles without re-running an event that already ran", async () => {
    const s = store();
    const d = dispatcher(() => {});

    expect(await processEvents([trigger(1000, 6)], d, s, () => {})).toEqual([
      "sched-1:1000",
    ]);
    expect(await processEvents([trigger(1000, 6)], d, s, () => {})).toEqual([
      "sched-1:1000",
    ]);
    expect(d.calls()).toBe(1);
  });

  it("settles an older fire once a newer one for the same key has run", async () => {
    const s = store();
    const d = dispatcher(() => {});

    await processEvents([trigger(2000, 7)], d, s, () => {});
    expect(await processEvents([trigger(1000, 6)], d, s, () => {})).toEqual([
      "sched-1:1000",
    ]);
    expect(d.calls()).toBe(1);
  });

  // TEST_SCENARIO: dedupe rests on the id's ts alone and NaN <= x is false, so without settling here a malformed id would re-run on every poll forever.
  it("settles an id with no readable fire time without ever running it", async () => {
    const s = store();
    const d = dispatcher(() => {});
    const malformed = { ...trigger(1000, 6), id: "sched-1:not-a-number" };

    for (const _ of [1, 2]) {
      expect(await processEvents([malformed], d, s, () => {})).toEqual([
        "sched-1:not-a-number",
      ]);
    }
    expect(d.calls()).toBe(0);
  });

  // TEST_SCENARIO: a failed workspace mutation is reported with its reason and holds the events queued behind it — an initialization session must not open on a seed that has not happened — while a failed trigger neither reports nor halts.
  it("halts behind a failed workspace mutation and reports it", async () => {
    const s = store();
    const invoked: string[] = [];
    const d: EventDispatcher = {
      invoke: async (kind) => {
        invoked.push(kind);
        if (kind === "workspace-seed") throw new Error("clone refused");
      },
    };
    const reports: { id: string; message: string }[] = [];
    const settled = await processEvents(
      [
        {
          id: "workspace-seed:agent-1:1000",
          kind: "workspace-seed",
          version: 6,
          expiresAt: new Date(Date.now() + 3600_000).toISOString(),
          payload: { url: "https://github.com/acme/def" },
        },
        {
          id: "initialization:agent-1:1001",
          kind: "initialization",
          version: 7,
          expiresAt: new Date(Date.now() + 3600_000).toISOString(),
          payload: { task: "hello" },
        },
      ],
      d,
      s,
      () => {},
      async (e, message) => {
        reports.push({ id: e.id, message });
      },
    );
    expect(settled).toEqual([]);
    expect(invoked).toEqual(["workspace-seed"]);
    expect(reports).toEqual([
      { id: "workspace-seed:agent-1:1000", message: "clone refused" },
    ]);
  });

  it("keeps going past a failed trigger without reporting", async () => {
    const s = store();
    const reports: string[] = [];
    const d: EventDispatcher = {
      invoke: async (_kind, _payload, id) => {
        if (id === "sched-1:1000") throw new Error("busy");
      },
    };
    const second: Event = { ...trigger(2000, 7), id: "sched-2:2000" };
    const settled = await processEvents(
      [trigger(1000, 6), second],
      d,
      s,
      () => {},
      async (e) => {
        reports.push(e.id);
      },
    );
    expect(settled).toEqual(["sched-2:2000"]);
    expect(reports).toEqual([]);
  });
});
