import { describe, it, expect } from "vitest";
import { createCronSweep } from "../../modules/runtime-delivery/services/cron-sweep.js";
import type { OutboxRepo, OutboxRow } from "../../modules/runtime-delivery/infrastructure/outbox-repo.js";
import type { StateQueue } from "../../modules/runtime-delivery/infrastructure/state-queue.js";
import type { IsAgentRunning } from "../../modules/runtime-delivery/services/worker-handler.js";

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

function harness(retryable: OutboxRow[], running: Set<string>) {
  const enqueued: string[] = [];
  const outboxRepo = {
    listRetryable: async () => retryable,
    deleteExpiredEvents: async () => 0,
  } as unknown as OutboxRepo;
  const queue = {
    enqueue: async (agentId: string) => {
      enqueued.push(agentId);
    },
  } as unknown as StateQueue;
  const agentRunningPort: IsAgentRunning = {
    isRunning: async (id) => running.has(id),
  };
  const sweep = createCronSweep({
    outboxRepo,
    queue,
    agentRunningPort,
    log: () => {},
  });
  return { sweep, enqueued };
}

describe("runtime cron-sweep", () => {
  it("re-enqueues rows for running agents only", async () => {
    const { sweep, enqueued } = harness(
      [row("agent-live"), row("agent-stopped")],
      new Set(["agent-live"]),
    );

    await sweep.tick();

    expect(enqueued).toEqual(["agent-live"]);
  });

  it("skips every row when no agent is running", async () => {
    const { sweep, enqueued } = harness(
      [row("agent-a"), row("agent-b")],
      new Set(),
    );

    await sweep.tick();

    expect(enqueued).toEqual([]);
  });

  it("treats an isRunning check that throws as not-running", async () => {
    const enqueued: string[] = [];
    const outboxRepo = {
      listRetryable: async () => [row("agent-x")],
      deleteExpiredEvents: async () => 0,
    } as unknown as OutboxRepo;
    const queue = {
      enqueue: async (agentId: string) => {
        enqueued.push(agentId);
      },
    } as unknown as StateQueue;
    const agentRunningPort: IsAgentRunning = {
      isRunning: async () => {
        throw new Error("k8s unreachable");
      },
    };
    const sweep = createCronSweep({
      outboxRepo,
      queue,
      agentRunningPort,
      log: () => {},
    });

    await sweep.tick();

    expect(enqueued).toEqual([]);
  });
});
