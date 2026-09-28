import type { PodSession } from "agent-runtime-api";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

import type { InfraAgent } from "../../modules/agents/infrastructure/agent-mappers.js";
import type { AttentionRecordRow } from "../../modules/attention/domain/types.js";
import type { AttentionRepository } from "../../modules/attention/infrastructure/attention-repository.js";
import { createSessionWatcher } from "../../modules/attention/services/session-watcher.js";

/*
 * TEST_OVERVIEW: the lease-elected watcher's write path — one capture per
 * agent at a time, a row removed when the agent stops listing its session,
 * and a failed pass retried instead of waiting for a notice that may never
 * come.
 */

const CAPTURE_RETRY_MS = 15_000;
const CAPTURE_DEBOUNCE_MS = 250;

function session(sessionId: string, updatedAt: string | null): PodSession {
  return {
    sessionId,
    mode: "chat",
    type: "regular",
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt,
    title: null,
    scheduleId: null,
    experimentId: null,
    threadTs: null,
    seenAt: null,
    runStartedAt: null,
    runTotalMs: null,
    runCount: null,
    running: false,
  };
}

function agent(id: string, owner: string): InfraAgent {
  return {
    id,
    name: id,
    owner,
    ready: true,
    hibernated: false,
    stopRequested: false,
    overBudget: false,
    sweepable: false,
    lifetimeMs: 0,
    podRestarts: 0,
    spec: {},
  } as unknown as InfraAgent;
}

interface Harness {
  watcher: ReturnType<typeof createSessionWatcher>;
  notify: () => void;
  upserted: string[];
  deleted: string[][];
  reads: number;
  setSessions: (sessions: PodSession[]) => void;
  failNextWrite: () => void;
  settleRead: () => void;
  holdReads: (held: boolean) => void;
}

function harness(): Harness {
  let listed: PodSession[] = [];
  let onNotice: () => void = () => {};
  let failWrite = false;
  let holding = false;
  let releaseRead: (() => void) | null = null;
  const stored = new Map<string, AttentionRecordRow>();

  const state: Partial<Harness> = {
    upserted: [],
    deleted: [],
    reads: 0,
  };

  const repo: AttentionRepository = {
    listForAgent: async () => [...stored.values()],
    listForOwner: async () => [],
    upsertRecord: async (row) => {
      if (failWrite) {
        failWrite = false;
        throw new Error("postgres is away");
      }
      stored.set(row.sessionId, row);
      state.upserted?.push(row.sessionId);
    },
    listDismissals: async () => [],
    ownedSessionKeys: async () => new Set<string>(),
    setDismissals: async () => {},
    deleteSessions: async (_agentId, sessionIds) => {
      if (failWrite) {
        failWrite = false;
        throw new Error("postgres is away");
      }
      for (const id of sessionIds) stored.delete(id);
      state.deleted?.push([...sessionIds]);
    },
    deleteOlderThan: async () => 0,
    listAgentIds: async () => [],
    deleteForAgent: async () => {},
  };

  const read = async (): Promise<PodSession[]> => {
    state.reads = (state.reads ?? 0) + 1;
    if (holding) {
      await new Promise<void>((resolve) => {
        releaseRead = resolve;
      });
    }
    return listed;
  };

  const watcher = createSessionWatcher({
    listAgents: async () => [agent("a1", "owner-1")],
    runtimeFeaturesFor: async () =>
      new Map([["a1", { liveUpdates: true } as never]]),
    pods: {
      watchAgent: (_agentId, notice) => {
        onNotice = notice;
        return { close: () => {}, listSessions: read };
      },
      listSessions: read,
    },
    repo,
    log: () => {},
  });

  return Object.assign(state, {
    watcher,
    notify: () => onNotice(),
    setSessions: (sessions: PodSession[]) => {
      listed = sessions;
    },
    failNextWrite: () => {
      failWrite = true;
    },
    holdReads: (held: boolean) => {
      holding = held;
    },
    settleRead: () => {
      releaseRead?.();
      releaseRead = null;
    },
  }) as Harness;
}

const flush = async () => {
  for (let i = 0; i < 6; i += 1) await Promise.resolve();
};

describe("createSessionWatcher", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /*
   * TEST_SCENARIO: two notices arrive while a pod read is still in flight. A
   * second capture must not start beside the first — two in flight can
   * interleave and let the slower one delete rows the newer list already
   * wrote — but the last notice must still be honored once the first pass
   * ends.
   */
  it("runs one capture per agent at a time and honors the last notice", async () => {
    const h = harness();
    h.setSessions([session("s1", "2026-09-10T00:00:00.000Z")]);
    h.holdReads(true);

    h.watcher.start();
    await flush();
    expect(h.reads).toBe(1);

    h.notify();
    h.notify();
    await vi.advanceTimersByTimeAsync(CAPTURE_DEBOUNCE_MS);
    expect(h.reads).toBe(1);

    h.holdReads(false);
    h.settleRead();
    await flush();
    expect(h.reads).toBe(2);

    h.watcher.stop();
  });

  /*
   * TEST_SCENARIO: the agent stops listing a session. The record is a
   * notification ledger, not a session store, so a session the agent no
   * longer lists must lose its row rather than linger as a card nothing
   * stands behind.
   */
  it("removes the row for a session the agent no longer lists", async () => {
    const h = harness();
    h.setSessions([
      session("s1", "2026-09-10T00:00:00.000Z"),
      session("s2", "2026-09-10T00:00:00.000Z"),
    ]);

    h.watcher.start();
    await flush();
    expect(h.upserted).toEqual(["s1", "s2"]);

    h.setSessions([session("s1", "2026-09-10T00:00:00.000Z")]);
    h.notify();
    await vi.advanceTimersByTimeAsync(CAPTURE_DEBOUNCE_MS);
    await flush();

    expect(h.deleted).toEqual([["s2"]]);
    h.watcher.stop();
  });

  /*
   * TEST_SCENARIO: a write fails mid-pass. A watched agent is captured only
   * when its session list changes, so without a retry the removal waits for
   * a notice that a quiet agent never sends, and the stale card stays on the
   * feed.
   */
  it("retries a capture the database refused", async () => {
    const h = harness();
    h.setSessions([
      session("s1", "2026-09-10T00:00:00.000Z"),
      session("s2", "2026-09-10T00:00:00.000Z"),
    ]);

    h.watcher.start();
    await flush();

    h.setSessions([session("s1", "2026-09-10T00:00:00.000Z")]);
    h.failNextWrite();
    h.notify();
    await vi.advanceTimersByTimeAsync(CAPTURE_DEBOUNCE_MS);
    await flush();
    expect(h.deleted).toEqual([]);

    await vi.advanceTimersByTimeAsync(CAPTURE_RETRY_MS);
    await flush();
    expect(h.deleted).toEqual([["s2"]]);

    h.watcher.stop();
  });
});
