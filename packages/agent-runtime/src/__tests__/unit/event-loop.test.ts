// TEST_OVERVIEW: processEvents settles exactly the events that ran (or superseded/expired ones) — a transiently failed dispatch must stay pending so the outbox retry re-runs it.
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Event } from "agent-runtime-api";
import { createFileDocumentStoreBackend } from "../../core/document-store.js";
import type { EventDispatcher } from "../../modules/runtime-channel/event-dispatcher.js";
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
});
