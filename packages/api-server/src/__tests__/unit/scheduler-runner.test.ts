import { describe, it, expect } from "vitest";
import type { Schedule } from "api-server-api";
import { createSchedulerRunner } from "../../modules/schedules/services/scheduler-runner.js";
import type { SchedulesRepository } from "../../modules/schedules/infrastructure/schedules-repository.js";
import type { ScheduleQueue } from "../../modules/schedules/infrastructure/schedule-queue.js";
import type { RuntimeMutator } from "../../modules/runtime-delivery/index.js";

const AGENT_ID = "agent-1";
const SCHEDULE_ID = "sched-1";

function makeSchedule(storedNextRun?: string): Schedule {
  return {
    id: SCHEDULE_ID,
    agentId: AGENT_ID,
    name: "hourly",
    spec: {
      version: "1",
      type: "cron",
      cron: "0 * * * *",
      task: "do the thing",
      enabled: true,
      createdBy: "user",
    },
    ...(storedNextRun ? { status: { nextRun: storedNextRun } } : {}),
  };
}

function makeDeps(opts?: { wakeError?: Error; storedNextRun?: string }) {
  const calls: string[] = [];
  const fires: { result: string; nextRun: Date | null }[] = [];
  const enqueued: Date[] = [];
  const events: string[] = [];

  const repo = {
    async getById(id: string) {
      return id === SCHEDULE_ID ? makeSchedule(opts?.storedNextRun) : null;
    },
    async getOwnerById() {
      return "owner-sub";
    },
    async recordFire(_id: string, result: string, nextRun: Date | null) {
      fires.push({ result, nextRun });
    },
    async setNextRun() {},
    async listAllEnabled() {
      return [makeSchedule(opts?.storedNextRun)];
    },
  } as unknown as SchedulesRepository;

  const queue = {
    async enqueue(_id: string, fireAt: Date) {
      enqueued.push(fireAt);
    },
    async cancel() {},
    async close() {},
  } as unknown as ScheduleQueue;

  const runtimeMutator: RuntimeMutator = {
    async bump(agentId, evts) {
      calls.push(`bump:${agentId}`);
      for (const e of evts) events.push(e.id);
      return 1;
    },
    async enqueueAfterCommit(agentId) {
      calls.push(`enqueue:${agentId}`);
    },
  };

  const runner = createSchedulerRunner({
    repo,
    queue,
    runtimeMutator,
    wakeAgent: async (agentId) => {
      calls.push(`wake:${agentId}`);
      if (opts?.wakeError) throw opts.wakeError;
    },
    log: () => {},
    now: () => new Date("2026-06-12T10:30:00Z"),
  });

  return { runner, calls, fires, enqueued, events };
}

describe("scheduler-runner fire", () => {
  it("commits the trigger event, then pokes the agent awake", async () => {
    const { runner, calls, fires } = makeDeps();

    await runner.buildFireHandler()(
      SCHEDULE_ID,
      new Date("2026-06-12T10:30:00Z"),
    );

    expect(calls).toEqual([
      `bump:${AGENT_ID}`,
      `enqueue:${AGENT_ID}`,
      `wake:${AGENT_ID}`,
    ]);
    expect(fires).toHaveLength(1);
    expect(fires[0]!.result).toBe("success");
  });

  // TEST_SCENARIO: a redelivered fire must mint the same event id — BullMQ is at-least-once, and only a fireAt-derived id lets the agent dedup the rerun.
  it("derives the trigger event id from the job's fireAt, not the wall clock", async () => {
    const { runner, events } = makeDeps();

    await runner.buildFireHandler()(
      SCHEDULE_ID,
      new Date("2026-06-12T10:00:00Z"),
    );
    await runner.buildFireHandler()(
      SCHEDULE_ID,
      new Date("2026-06-12T10:00:00Z"),
    );

    expect(events).toHaveLength(2);
    expect(events[0]!).toBe(events[1]!);
    expect(events[0]!).toBe(
      `${SCHEDULE_ID}:${Date.parse("2026-06-12T10:00:00Z")}`,
    );
  });

  // TEST_SCENARIO: a transient bump/wake failure must reach BullMQ so the attempts policy retries the occurrence — after the failure is recorded and the next occurrence re-armed.
  it("records a failed fire, re-arms, then rethrows so the queue retries", async () => {
    const { runner, calls, fires, enqueued } = makeDeps({
      wakeError: new Error("k8s api unreachable"),
    });

    await expect(
      runner.buildFireHandler()(SCHEDULE_ID, new Date("2026-06-12T10:30:00Z")),
    ).rejects.toThrow("k8s api unreachable");

    expect(calls).toContain(`bump:${AGENT_ID}`);
    expect(fires).toHaveLength(1);
    expect(fires[0]!.result).toContain("k8s api unreachable");
    expect(enqueued).toHaveLength(1);
    expect(enqueued[0]!.toISOString()).toBe("2026-06-12T11:00:00.000Z");
  });

  // TEST_SCENARIO: concurrent replica boots must converge on the stored nextRun — clock-derived fire times give each replica its own jobId and a duplicate trigger.
  it("restoreAll reuses a stored future nextRun instead of recomputing", async () => {
    const stored = "2026-06-12T10:45:00.000Z";
    const { runner, enqueued } = makeDeps({ storedNextRun: stored });

    await runner.restoreAll();

    expect(enqueued).toHaveLength(1);
    expect(enqueued[0]!.toISOString()).toBe(stored);
  });
});
