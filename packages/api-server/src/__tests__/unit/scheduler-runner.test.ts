import { describe, it, expect } from "vitest";
import type { Schedule } from "api-server-api";
import { createSchedulerRunner } from "../../modules/schedules/services/scheduler-runner.js";
import type { SchedulesRepository } from "../../modules/schedules/infrastructure/schedules-repository.js";
import type { ScheduleQueue } from "../../modules/schedules/infrastructure/schedule-queue.js";
import type { RuntimeMutator } from "../../modules/runtime-delivery/index.js";
import type { AgentActivityStamp } from "../../modules/agents/index.js";
import { createMemoryTtlStore } from "../../core/ttl-store.js";
import {
  events$,
  ofType,
  EventType,
  type ScheduleFired,
} from "../../events.js";

const AGENT_ID = "agent-1";
const SCHEDULE_ID = "sched-1";
const WAKE_STAMP = "2026-06-12T10:30:00.000Z";

function makeSchedule(
  storedNextRun?: string,
  cron = "0 * * * *",
  precheck?: string,
  lastRun?: string,
): Schedule {
  const status = {
    ...(storedNextRun ? { nextRun: storedNextRun } : {}),
    ...(lastRun ? { lastRun } : {}),
  };
  return {
    id: SCHEDULE_ID,
    agentId: AGENT_ID,
    name: "hourly",
    spec: {
      version: "1",
      type: "cron",
      cron,
      task: "do the thing",
      enabled: true,
      createdBy: "user",
      ...(precheck ? { precheck } : {}),
    },
    ...(Object.keys(status).length > 0 ? { status } : {}),
  };
}

function makeDeps(opts?: {
  wakeError?: Error;
  storedNextRun?: string;
  cron?: string;
  precheck?: string;
  lastRun?: string;
}) {
  const calls: string[] = [];
  const fires: { result: string; nextRun: Date | null }[] = [];
  const enqueued: Date[] = [];
  const ensured: Date[] = [];
  const events: string[] = [];
  const expiries: Date[] = [];
  const payloads: Record<string, unknown>[] = [];
  const declines: Date[] = [];
  const runs: { at: Date; result: string; precheckError: string | null }[] = [];
  const restored: { previous: string | null; written: string }[] = [];
  const stamps = createMemoryTtlStore<AgentActivityStamp>(60_000);

  const repo = {
    async getById(id: string) {
      return id === SCHEDULE_ID
        ? makeSchedule(
            opts?.storedNextRun,
            opts?.cron,
            opts?.precheck,
            opts?.lastRun,
          )
        : null;
    },
    async getOwnerById() {
      return "owner-sub";
    },
    async recordFire(_id: string, result: string, nextRun: Date | null) {
      fires.push({ result, nextRun });
    },
    async setNextRun() {},
    async recordDecline(_id: string, at: Date) {
      declines.push(at);
    },
    async recordRun(
      _id: string,
      at: Date,
      result: string,
      precheckError: string | null,
    ) {
      runs.push({ at, result, precheckError });
    },
    async listAllEnabled() {
      return [makeSchedule(opts?.storedNextRun, opts?.cron)];
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
      for (const e of evts) {
        events.push(e.id);
        expiries.push(e.expiresAt);
        payloads.push(e.payload as Record<string, unknown>);
      }
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
      return { previous: "2026-06-12T09:00:00.000Z", written: WAKE_STAMP };
    },
    restoreActivity: async (_agentId, stamp) => {
      restored.push(stamp);
    },
    activityStamps: stamps,
    log: () => {},
    now: () => new Date("2026-06-12T10:30:00Z"),
  });

  return {
    runner,
    calls,
    fires,
    enqueued,
    ensured,
    events,
    expiries,
    payloads,
    declines,
    runs,
    restored,
  };
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

  // TEST_SCENARIO: an hourly schedule fires at 10:30; the trigger expires at the 11:00 occurrence rather than after the one-hour TTL, so a fire the agent never received is superseded by the next one instead of piling up into a backlog that replays when the agent comes back.
  it("expires a fire at the schedule's next occurrence", async () => {
    const { runner, expiries } = makeDeps();

    await runner.buildFireHandler()(
      SCHEDULE_ID,
      new Date("2026-06-12T10:30:00Z"),
    );

    expect(expiries).toHaveLength(1);
    expect(expiries[0]!.toISOString()).toBe("2026-06-12T11:00:00.000Z");
  });

  // TEST_SCENARIO: a daily schedule's next occurrence is further away than the trigger TTL, so the TTL still caps how stale a fire can land.
  it("caps a fire's expiry at the trigger TTL when the next occurrence is far", async () => {
    const { runner, expiries } = makeDeps({ cron: "0 9 * * *" });

    await runner.buildFireHandler()(
      SCHEDULE_ID,
      new Date("2026-06-12T10:30:00Z"),
    );

    expect(expiries[0]!.toISOString()).toBe("2026-06-12T11:30:00.000Z");
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

describe("scheduler-runner precheck", () => {
  // TEST_SCENARIO: the pod decides the verdict, so a Precheck that finds nothing needs everything it will ask for in the fire's payload — the command, the occurrence it belongs to, and when a run last happened.
  it("carries the precheck, the occurrence and the last run into the fire payload", async () => {
    const { runner, payloads } = makeDeps({
      precheck:
        "git fetch -q && git log --oneline HEAD..origin/main | grep -q .",
      lastRun: "2026-06-12T09:00:00.000Z",
    });

    await runner.buildFireHandler()(
      SCHEDULE_ID,
      new Date("2026-06-12T10:30:00Z"),
    );

    expect(payloads[0]).toMatchObject({
      precheck:
        "git fetch -q && git log --oneline HEAD..origin/main | grep -q .",
      fireAt: "2026-06-12T10:30:00.000Z",
      lastRunAt: "2026-06-12T09:00:00.000Z",
    });
  });

  // TEST_SCENARIO: a Declined Fire already woke the Agent, so leaving the poke's activity stamp standing would hold a frequently-prechecked Agent awake forever and cost more compute than the turns it saved.
  it("a declined report counts the decline and restores the activity stamp the poke wrote", async () => {
    const { runner, declines, restored } = makeDeps({
      precheck: "test -f /tmp/ready",
    });
    const fireAt = new Date("2026-06-12T10:30:00Z");

    await runner.buildFireHandler()(SCHEDULE_ID, fireAt);
    await runner.reportFire(AGENT_ID, {
      scheduleId: SCHEDULE_ID,
      fireAt: fireAt.toISOString(),
      verdict: "declined",
    });

    expect(declines).toHaveLength(1);
    expect(restored).toEqual([
      { previous: "2026-06-12T09:00:00.000Z", written: WAKE_STAMP },
    ]);
  });

  // TEST_SCENARIO: the verdict lives in the pod, so a prechecked fire must not claim a run at send time — otherwise a schedule that declines every occurrence reads exactly like one that runs and succeeds.
  it("a prechecked fire arms the next occurrence without claiming a run", async () => {
    const { runner, fires, enqueued } = makeDeps({ precheck: "true" });

    await runner.buildFireHandler()(
      SCHEDULE_ID,
      new Date("2026-06-12T10:30:00Z"),
    );

    expect(fires).toHaveLength(0);
    expect(enqueued).toHaveLength(1);
  });

  // TEST_SCENARIO: a Precheck that broke let the run through, so the run is recorded — with the reason beside it, which is the only thing that keeps a permanently broken check from looking healthy.
  it("records the run when a broken precheck let it through", async () => {
    const { runner, runs } = makeDeps({ precheck: "true" });

    await runner.reportFire(AGENT_ID, {
      scheduleId: SCHEDULE_ID,
      fireAt: "2026-06-12T10:30:00.000Z",
      verdict: "precheck-failed",
      detail: "precheck exited 127",
    });

    expect(runs).toEqual([
      {
        at: new Date("2026-06-12T10:30:00Z"),
        result: "success",
        precheckError: "precheck exited 127",
      },
    ]);
  });

  // TEST_SCENARIO: the count answers "has the check found anything since work last happened?", so a real run has to clear it rather than let a lifetime total drown the recent picture.
  it("clears the decline count when a run finally happens", async () => {
    const { runner, runs } = makeDeps({ precheck: "true" });
    const fireAt = new Date("2026-06-12T10:30:00Z");

    await runner.buildFireHandler()(SCHEDULE_ID, fireAt);
    await runner.reportFire(AGENT_ID, {
      scheduleId: SCHEDULE_ID,
      fireAt: fireAt.toISOString(),
      verdict: "declined",
    });
    await runner.reportFire(AGENT_ID, {
      scheduleId: SCHEDULE_ID,
      fireAt: fireAt.toISOString(),
      verdict: "allowed",
    });

    expect(runs).toHaveLength(1);
  });

  // TEST_SCENARIO: a Precheck that broke still lets the run through, so a run cannot clear its failure count — only the script running and returning a verdict again can, which is what separates one hiccup from a week of breakage.
  it("counts consecutive precheck failures and clears them on a verdict", async () => {
    const { runner, runs, declines } = makeDeps({ precheck: "true" });
    const report = (verdict: "precheck-failed" | "declined") =>
      runner.reportFire(AGENT_ID, {
        scheduleId: SCHEDULE_ID,
        fireAt: "2026-06-12T10:30:00.000Z",
        verdict,
        ...(verdict === "precheck-failed"
          ? { detail: "precheck exited 2" }
          : {}),
      });

    await report("precheck-failed");
    await report("precheck-failed");
    await report("declined");

    expect(runs.map((r) => r.precheckError)).toEqual([
      "precheck exited 2",
      "precheck exited 2",
    ]);
    expect(declines).toHaveLength(1);
  });

  // TEST_SCENARIO: a report must only ever touch the reporting Agent's own Schedule — the harness surface is reached by any pod that knows a schedule id.
  it("ignores a report for a schedule that belongs to another agent", async () => {
    const { runner, declines, restored } = makeDeps({ precheck: "true" });

    await runner.reportFire("agent-other", {
      scheduleId: SCHEDULE_ID,
      fireAt: "2026-06-12T10:30:00.000Z",
      verdict: "declined",
    });

    expect(declines).toHaveLength(0);
    expect(restored).toHaveLength(0);
  });
});
