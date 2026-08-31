import { describe, it, expect } from "vitest";
import type { Schedule } from "api-server-api";
import { createSchedulerRunner } from "../../modules/schedules/services/scheduler-runner.js";
import type { SchedulesRepository } from "../../modules/schedules/infrastructure/schedules-repository.js";
import type { ScheduleQueue } from "../../modules/schedules/infrastructure/schedule-queue.js";
import type { RuntimeMutator } from "../../modules/runtime-delivery/index.js";
import {
  events$,
  ofType,
  EventType,
  type ScheduleFired,
} from "../../events.js";

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
  const ensured: Date[] = [];
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
    async ensure(_id: string, fireAt: Date) {
      ensured.push(fireAt);
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

  return { runner, calls, fires, enqueued, ensured, events };
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

  // TEST_SCENARIO: a failed fire with BullMQ attempts left must rethrow before any re-arm bookkeeping — the retry then repeats only the delivery attempt, and nextRun stays on the due occurrence so the retry and the reconcile sweep both target that same occurrence.
  it("records a failed fire against its own occurrence and rethrows without re-arming", async () => {
    const { runner, calls, fires, enqueued } = makeDeps({
      wakeError: new Error("k8s api unreachable"),
    });

    await expect(
      runner.buildFireHandler()(
        SCHEDULE_ID,
        new Date("2026-06-12T10:30:00Z"),
        false,
      ),
    ).rejects.toThrow("k8s api unreachable");

    expect(calls).toContain(`bump:${AGENT_ID}`);
    expect(fires).toHaveLength(1);
    expect(fires[0]!.result).toContain("k8s api unreachable");
    expect(fires[0]!.nextRun?.toISOString()).toBe("2026-06-12T10:30:00.000Z");
    expect(enqueued).toHaveLength(0);
  });

  // TEST_SCENARIO: once BullMQ's attempts are spent, the schedule must move on. Leaving nextRun on the dead occurrence makes the reconcile sweep revive the same failed job forever, so an hourly schedule whose agent was deleted never reaches 11:00 and looks enabled while being silently dead.
  it("advances to the next occurrence when the last attempt fails", async () => {
    const { runner, fires, enqueued } = makeDeps({
      wakeError: new Error("agent is gone"),
    });

    await expect(
      runner.buildFireHandler()(
        SCHEDULE_ID,
        new Date("2026-06-12T10:00:00Z"),
        true,
      ),
    ).rejects.toThrow("agent is gone");

    expect(fires[0]!.result).toContain("agent is gone");
    expect(fires[0]!.nextRun?.toISOString()).toBe("2026-06-12T11:00:00.000Z");
    expect(enqueued).toHaveLength(1);
    expect(enqueued[0]!.toISOString()).toBe("2026-06-12T11:00:00.000Z");
  });

  // TEST_SCENARIO: BullMQ runs a failing fire up to three times; the owner must get one failure record, not one per attempt.
  it("emits ScheduleFired(failure) once, on the terminal attempt", async () => {
    const seen: string[] = [];
    const sub = events$()
      .pipe(ofType<ScheduleFired>(EventType.ScheduleFired))
      .subscribe((event) => seen.push(event.outcome));
    try {
      const { runner } = makeDeps({ wakeError: new Error("agent is gone") });
      const fire = runner.buildFireHandler();
      const at = new Date("2026-06-12T10:00:00Z");

      await expect(fire(SCHEDULE_ID, at, false)).rejects.toThrow();
      await expect(fire(SCHEDULE_ID, at, false)).rejects.toThrow();
      await expect(fire(SCHEDULE_ID, at, true)).rejects.toThrow();

      expect(seen).toEqual(["failure"]);
    } finally {
      sub.unsubscribe();
    }
  });

  // TEST_SCENARIO: a successful fire re-arms the next occurrence exactly once.
  it("re-arms the next occurrence after a successful fire", async () => {
    const { runner, fires, enqueued } = makeDeps();

    await runner.buildFireHandler()(
      SCHEDULE_ID,
      new Date("2026-06-12T10:30:00Z"),
    );

    expect(fires[0]!.result).toBe("success");
    expect(enqueued).toHaveLength(1);
    expect(enqueued[0]!.toISOString()).toBe("2026-06-12T11:00:00.000Z");
  });

  // TEST_SCENARIO: concurrent replica boots must converge on the stored nextRun — clock-derived fire times give each replica its own jobId and a duplicate trigger.
  it("restoreAll reuses a stored future nextRun instead of recomputing", async () => {
    const stored = "2026-06-12T10:45:00.000Z";
    const { runner, enqueued, ensured } = makeDeps({ storedNextRun: stored });

    await runner.restoreAll();

    expect(ensured).toHaveLength(1);
    expect(ensured[0]!.toISOString()).toBe(stored);
    expect(enqueued).toHaveLength(0);
  });

  // TEST_SCENARIO: a replica booting mid-deploy while a fire is due must not skip to the next occurrence — the due fire runs late rather than never.
  it("restoreAll keeps an overdue stored nextRun instead of skipping past it", async () => {
    const stored = "2026-06-12T10:00:00.000Z";
    const { runner, ensured } = makeDeps({ storedNextRun: stored });

    await runner.restoreAll();

    expect(ensured).toHaveLength(1);
    expect(ensured[0]!.toISOString()).toBe(stored);
  });
});
