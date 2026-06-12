import { describe, it, expect } from "vitest";
import type { Schedule } from "api-server-api";
import { createSchedulerRunner } from "../../modules/schedules/services/scheduler-runner.js";
import type { SchedulesRepository } from "../../modules/schedules/infrastructure/schedules-repository.js";
import type { ScheduleQueue } from "../../modules/schedules/infrastructure/schedule-queue.js";
import type { RuntimeMutator } from "../../modules/runtime-delivery/index.js";

const AGENT_ID = "agent-1";
const SCHEDULE_ID = "sched-1";

function makeSchedule(): Schedule {
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
  };
}

function makeDeps(opts?: { wakeError?: Error }) {
  const calls: string[] = [];
  const fires: { result: string; nextRun: Date | null }[] = [];
  const enqueued: Date[] = [];

  const repo = {
    async getById(id: string) {
      return id === SCHEDULE_ID ? makeSchedule() : null;
    },
    async getOwnerById() {
      return "owner-sub";
    },
    async recordFire(_id: string, result: string, nextRun: Date | null) {
      fires.push({ result, nextRun });
    },
    async setNextRun() {},
    async listAllEnabled() {
      return [makeSchedule()];
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
    async bump(agentId) {
      calls.push(`bump:${agentId}`);
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

  return { runner, calls, fires, enqueued };
}

describe("scheduler-runner fire", () => {
  it("commits the trigger event, then pokes the agent awake", async () => {
    const { runner, calls, fires } = makeDeps();

    await runner.buildFireHandler()(SCHEDULE_ID);

    expect(calls).toEqual([
      `bump:${AGENT_ID}`,
      `enqueue:${AGENT_ID}`,
      `wake:${AGENT_ID}`,
    ]);
    expect(fires).toHaveLength(1);
    expect(fires[0]!.result).toBe("success");
  });

  it("records a failed fire and still re-arms when the wake poke fails", async () => {
    const { runner, calls, fires, enqueued } = makeDeps({
      wakeError: new Error("k8s api unreachable"),
    });

    await runner.buildFireHandler()(SCHEDULE_ID);

    // The event was committed before the poke — it survives in the outbox.
    expect(calls).toContain(`bump:${AGENT_ID}`);
    expect(fires).toHaveLength(1);
    expect(fires[0]!.result).toContain("k8s api unreachable");
    expect(enqueued).toHaveLength(1);
    expect(enqueued[0]!.toISOString()).toBe("2026-06-12T11:00:00.000Z");
  });
});
