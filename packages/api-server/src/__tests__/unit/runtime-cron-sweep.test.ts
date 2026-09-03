/** TEST_OVERVIEW: the cron sweep's re-enqueue gate — the recovery path that
 *  re-dispatches outbox rows an agent is behind on. A row belonging to an agent
 *  that is not Ready is left for a later tick, because the worker could only
 *  exit clean; a row whose running state could not be determined is still
 *  re-enqueued, so a failing check never silences the recovery path. */
import { describe, it, expect } from "vitest";
import { createCronSweep } from "../../modules/runtime-delivery/services/cron-sweep.js";
import type {
  OutboxRepo,
  OutboxRow,
} from "../../modules/runtime-delivery/infrastructure/outbox-repo.js";
import type { StateQueue } from "../../modules/runtime-delivery/infrastructure/state-queue.js";

function row(agentId: string): OutboxRow {
  return {
    agentId,
    version: 3,
    lastEnqueuedAt: new Date(0),
    lastSettledVersion: 2,
    lastAppliedVersion: 2,
    lastAppliedHash: null,
    lastAppliedAt: null,
    applyFailures: [],
    applyAttempts: 0,
  };
}

function harness(opts: {
  retryable: OutboxRow[];
  isRunning: (agentId: string) => Promise<boolean>;
  runningCheckTimeoutMs?: number;
  runningCheckConcurrency?: number;
}) {
  const enqueued: string[] = [];
  const logs: string[] = [];
  let expiredDrops = 0;
  const outboxRepo = {
    listRetryable: async () => opts.retryable,
    deleteExpiredEvents: async () => {
      expiredDrops += 1;
      return 0;
    },
  } as unknown as OutboxRepo;
  const queue = {
    enqueue: async (agentId: string) => {
      enqueued.push(agentId);
    },
    enqueueMany: async (agentIds: string[]) => {
      enqueued.push(...agentIds);
    },
  } as unknown as StateQueue;
  const sweep = createCronSweep({
    outboxRepo,
    queue,
    agentRunningPort: { isRunning: opts.isRunning },
    log: (msg) => logs.push(msg),
    ...(opts.runningCheckTimeoutMs !== undefined
      ? { runningCheckTimeoutMs: opts.runningCheckTimeoutMs }
      : {}),
    ...(opts.runningCheckConcurrency !== undefined
      ? { runningCheckConcurrency: opts.runningCheckConcurrency }
      : {}),
  });
  return { sweep, enqueued, logs, expiredDrops: () => expiredDrops };
}

describe("runtime cron-sweep", () => {
  /** TEST_SCENARIO: a mixed batch enqueues only the agent that is Ready. */
  it("re-enqueues rows for running agents only", async () => {
    const running = new Set(["agent-live"]);
    const { sweep, enqueued } = harness({
      retryable: [row("agent-live"), row("agent-stopped")],
      isRunning: async (id) => running.has(id),
    });

    await sweep.tick();

    expect(enqueued).toEqual(["agent-live"]);
  });

  /** TEST_SCENARIO: an all-hibernated batch enqueues nothing, which is what
   *  breaks the fixed-cadence re-sync loop. */
  it("skips every row when no agent is running", async () => {
    const { sweep, enqueued } = harness({
      retryable: [row("agent-a"), row("agent-b")],
      isRunning: async () => false,
    });

    await sweep.tick();

    expect(enqueued).toEqual([]);
  });

  /** TEST_SCENARIO: skipping defers delivery, it does not drop it — the row is
   *  re-enqueued on the first tick after the agent reports Ready. */
  it("delivers a skipped row on the tick after its agent becomes Ready", async () => {
    const running = new Set<string>();
    const { sweep, enqueued } = harness({
      retryable: [row("agent-waking")],
      isRunning: async (id) => running.has(id),
    });

    await sweep.tick();
    expect(enqueued).toEqual([]);

    running.add("agent-waking");
    await sweep.tick();

    expect(enqueued).toEqual(["agent-waking"]);
  });

  /** TEST_SCENARIO: a rejecting check is "unknown", not "stopped" — the row is
   *  re-enqueued and the worker re-applies the same gate one step later. */
  it("re-enqueues when the running-state check rejects", async () => {
    const { sweep, enqueued, logs } = harness({
      retryable: [row("agent-x")],
      isRunning: async () => {
        throw new Error("k8s unreachable");
      },
    });

    await sweep.tick();

    expect(enqueued).toEqual(["agent-x"]);
    expect(logs.join("\n")).toContain("running-state check failed for 1");
    expect(logs.join("\n")).toContain("k8s unreachable");
  });

  /** TEST_SCENARIO: a synchronous throw is caught on the same path as a
   *  rejected promise. */
  it("re-enqueues when the running-state check throws synchronously", async () => {
    const { sweep, enqueued } = harness({
      retryable: [row("agent-x")],
      isRunning: (): Promise<boolean> => {
        throw new Error("client not initialised");
      },
    });

    await sweep.tick();

    expect(enqueued).toEqual(["agent-x"]);
  });

  /** TEST_SCENARIO: a check that never settles cannot wedge the tick — the
   *  deadline resolves it as unknown and the sweep runs to completion. */
  it("re-enqueues and completes the tick when the running-state check hangs", async () => {
    const { sweep, enqueued, logs, expiredDrops } = harness({
      retryable: [row("agent-hung")],
      isRunning: () => new Promise<boolean>(() => {}),
      runningCheckTimeoutMs: 10,
    });

    await sweep.tick();

    expect(enqueued).toEqual(["agent-hung"]);
    expect(logs.join("\n")).toContain("timed out after 10ms");
    expect(expiredDrops()).toBe(1);
  });

  /** TEST_SCENARIO: the expired-event drop is not gated on the running check,
   *  so it still runs on a tick where every row is skipped. */
  it("drops expired events even when every row is skipped", async () => {
    const { sweep, enqueued, expiredDrops } = harness({
      retryable: [row("agent-a")],
      isRunning: async () => false,
    });

    await sweep.tick();

    expect(enqueued).toEqual([]);
    expect(expiredDrops()).toBe(1);
  });

  /** TEST_SCENARIO: while the readiness source is down every check is a live
   *  Kubernetes read, so the sweep stops asking after one round of failures
   *  instead of reissuing that read for every row it scanned. Rows it never
   *  asked about are unknown, so they still re-enqueue. A lane can already be
   *  mid-read when another trips the threshold, so the bound is the lanes twice
   *  over, not the scan. */
  it("stops checking after a round of failures and re-enqueues the rest", async () => {
    const asked: string[] = [];
    const { sweep, enqueued } = harness({
      retryable: [
        row("agent-a"),
        row("agent-b"),
        row("agent-c"),
        row("agent-d"),
        row("agent-e"),
        row("agent-f"),
      ],
      runningCheckConcurrency: 2,
      isRunning: async (id) => {
        asked.push(id);
        throw new Error("k8s unreachable");
      },
    });

    await sweep.tick();

    expect(asked.length).toBeLessThanOrEqual(3);
    expect(enqueued).toHaveLength(6);
  });

  /** TEST_SCENARIO: the threshold is a round of failures with no success
   *  between them, not a running total. Transient errors scattered through a
   *  long tick must not convince the sweep the readiness source is down, which
   *  would call every remaining row unknown and re-enqueue a job for each
   *  stopped agent. Two lanes cannot reach the fourth row before a success has
   *  landed, so the reset is what keeps the scan going. */
  it("keeps checking when failures are scattered between successes", async () => {
    const failing = new Set(["agent-a", "agent-d"]);
    const asked: string[] = [];
    const { sweep, enqueued } = harness({
      retryable: [
        row("agent-a"),
        row("agent-b"),
        row("agent-c"),
        row("agent-d"),
        row("agent-e"),
        row("agent-f"),
        row("agent-g"),
        row("agent-h"),
      ],
      runningCheckConcurrency: 2,
      isRunning: async (id) => {
        asked.push(id);
        if (failing.has(id)) throw new Error("transient");
        return true;
      },
    });

    await sweep.tick();

    expect(asked).toHaveLength(8);
    expect(enqueued).toHaveLength(8);
  });

  /** TEST_SCENARIO: the skip line reports only agents the check answered for,
   *  so a failed check is never reported as a stopped agent. */
  it("does not report a failed check as a stopped agent", async () => {
    const { sweep, logs } = harness({
      retryable: [row("agent-x")],
      isRunning: async () => {
        throw new Error("403 forbidden");
      },
    });

    await sweep.tick();

    expect(logs.join("\n")).not.toContain("skipped");
  });
});
