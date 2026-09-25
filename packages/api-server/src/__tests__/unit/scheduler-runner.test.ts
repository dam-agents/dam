import { describe, it, expect } from "vitest";
import type { Schedule } from "api-server-api";
import { createSchedulerRunner } from "../../modules/schedules/services/scheduler-runner.js";
import type { SchedulesRepository } from "../../modules/schedules/infrastructure/schedules-repository.js";
import type { ScheduleQueue } from "../../modules/schedules/infrastructure/schedule-queue.js";
import type { RuntimeMutator } from "../../modules/runtime-delivery/index.js";
import type { AgentActivityStamp } from "../../modules/agents/index.js";
import { createMemoryTtlStore } from "../../core/ttl-store.js";
import type { ScheduleStatusPatch } from "../../modules/schedules/domain/status-transitions.js";
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
  enabled = true,
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
      enabled,
      createdBy: "user",
      ...(precheck ? { precheck } : {}),
    },
    ...(Object.keys(status).length > 0 ? { status } : {}),
  };
}

function makeDeps(opts?: {
  wakeError?: Error;
  bumpError?: Error;
  enqueueError?: Error;
  storedNextRun?: string;
  cron?: string;
  precheck?: string;
  lastRun?: string;
  onboardingPending?: boolean;
  enabled?: boolean;
}) {
  const calls: string[] = [];
  const fires: { result: string; nextRun: Date | null }[] = [];
  const nextRuns: (Date | null)[] = [];
  const stampedFires: string[] = [];
  const enqueued: Date[] = [];
  const ensured: Date[] = [];
  const events: string[] = [];
  const expiries: Date[] = [];
  const payloads: Record<string, unknown>[] = [];
  const patches: ScheduleStatusPatch[] = [];
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
            opts?.enabled,
          )
        : null;
    },
    async getOwnerById() {
      return "owner-sub";
    },
    async recordFire(_id: string, result: string, nextRun: Date | null) {
      fires.push({ result, nextRun });
    },
    async setNextRun(_id: string, nextRun: Date | null) {
      nextRuns.push(nextRun);
    },
    async stampFire(_id: string, result: string) {
      stampedFires.push(result);
    },
    async applyStatusPatch(_id: string, patch: ScheduleStatusPatch) {
      patches.push(patch);
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
      if (opts?.bumpError) throw opts.bumpError;
      for (const e of evts) {
        events.push(e.id);
        expiries.push(e.expiresAt);
        payloads.push(e.payload as Record<string, unknown>);
      }
      return 1;
    },
    async enqueueAfterCommit(agentId) {
      calls.push(`enqueue:${agentId}`);
      if (opts?.enqueueError) throw opts.enqueueError;
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
    ...(opts?.onboardingPending !== undefined
      ? { onboardingPending: async () => opts.onboardingPending === true }
      : {}),
    log: () => {},
    now: () => new Date("2026-06-12T10:30:00Z"),
  });

  return {
    runner,
    calls,
    fires,
    nextRuns,
    stampedFires,
    enqueued,
    ensured,
    events,
    expiries,
    payloads,
    patches,
    restored,
  };
}

describe("scheduler-runner fire", () => {
  it("holds the occurrence while the agent has not finished onboarding, and keeps the cadence", async () => {
    const { runner, calls, fires, enqueued } = makeDeps({
      onboardingPending: true,
    });

    await runner.buildFireHandler()(
      SCHEDULE_ID,
      new Date("2026-06-12T10:30:00Z"),
    );

    expect(calls).toEqual([]);
    expect(fires).toEqual([
      {
        result: "held: onboarding not complete",
        nextRun: new Date("2026-06-12T11:00:00Z"),
      },
    ]);
    expect(enqueued).toEqual([new Date("2026-06-12T11:00:00Z")]);
  });

  it("fires normally once onboarding is complete", async () => {
    const { runner, calls } = makeDeps({ onboardingPending: false });

    await runner.buildFireHandler()(
      SCHEDULE_ID,
      new Date("2026-06-12T10:30:00Z"),
    );

    expect(calls).toContain(`wake:${AGENT_ID}`);
  });

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
  // TEST_SCENARIO: the pod decides the verdict, so the fire's payload must carry everything the Precheck will ask for.
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

  // TEST_SCENARIO: a Declined Fire already woke the Agent, so leaving the poke's stamp standing would hold a frequent Precheck's Agent awake forever.
  it("a declined report restores the activity stamp the poke wrote", async () => {
    const { runner, patches, restored } = makeDeps({
      precheck: "test -f /tmp/ready",
    });
    const fireAt = new Date("2026-06-12T10:30:00Z");

    await runner.buildFireHandler()(SCHEDULE_ID, fireAt);
    await runner.reportFire({
      scheduleId: SCHEDULE_ID,
      eventId: `${SCHEDULE_ID}:${fireAt.getTime()}`,
      ranPrecheck: "test -f /tmp/ready",
      outcome: "declined",
    });

    expect(patches).toHaveLength(1);
    expect(restored).toEqual([
      { previous: "2026-06-12T09:00:00.000Z", written: WAKE_STAMP },
    ]);
  });

  // TEST_SCENARIO: claiming a run at send time would make a Schedule that declines every occurrence read like one that succeeds.
  it("a prechecked fire arms the next occurrence without claiming a run", async () => {
    const { runner, fires, enqueued } = makeDeps({ precheck: "true" });

    await runner.buildFireHandler()(
      SCHEDULE_ID,
      new Date("2026-06-12T10:30:00Z"),
    );

    expect(fires).toHaveLength(0);
    expect(enqueued).toHaveLength(1);
  });

  // TEST_SCENARIO: the runner hands the verdict to the transition rather than deciding the columns itself.
  it("records a broken precheck's run through the status transition", async () => {
    const { runner, patches } = makeDeps({ precheck: "true" });

    await runner.reportFire({
      scheduleId: SCHEDULE_ID,
      eventId: `${SCHEDULE_ID}:0`,
      ranPrecheck: "true",
      outcome: "failed",
      detail: "precheck exited 127",
    });

    expect(patches[0]).toMatchObject({
      lastFiredAt: new Date("2026-06-12T10:30:00Z"),
      lastPrecheckError: "precheck exited 127",
      precheckFailedCount: { kind: "increment" },
    });
  });

  // TEST_SCENARIO: the check runs detached for minutes, so an owner can swap the command while one is in flight — and the old command's verdict must not be written against the new one, nor wipe what the new one already recorded.
  it("drops a verdict that describes a precheck the schedule no longer runs", async () => {
    const { runner, patches } = makeDeps({ precheck: "new.sh" });

    await runner.reportFire({
      scheduleId: SCHEDULE_ID,
      eventId: `${SCHEDULE_ID}:0`,
      ranPrecheck: "old.sh",
      outcome: "declined",
    });

    expect(patches).toHaveLength(0);
  });
});

describe("scheduler-runner runNow", () => {
  // TEST_SCENARIO: trying a Schedule out must not shift when it next fires — so an on-demand run writes no nextRun and arms no queue job, and the cadence the user was waiting for stays exactly where it was.
  it("delivers the fire without touching the cadence", async () => {
    const { runner, calls, nextRuns, enqueued } = makeDeps();

    await expect(runner.runNow(SCHEDULE_ID)).resolves.toBe("started");

    expect(calls).toEqual([
      `bump:${AGENT_ID}`,
      `enqueue:${AGENT_ID}`,
      `wake:${AGENT_ID}`,
    ]);
    expect(nextRuns).toEqual([]);
    expect(enqueued).toEqual([]);
  });

  // TEST_SCENARIO: the Agent dedups a redelivered fire by event id, so an on-demand fire must not reuse the id of the occurrence it happens to land in — that would make the Agent drop whichever of the two arrived second.
  it("mints an event id of its own rather than an occurrence's", async () => {
    const { runner, events } = makeDeps();
    const occurrence = new Date("2026-06-12T10:00:00Z");

    await runner.buildFireHandler()(SCHEDULE_ID, occurrence);
    await runner.runNow(SCHEDULE_ID);

    expect(events[1]).not.toBe(events[0]);
    expect(events[1]).toBe(`run:${SCHEDULE_ID}:${Date.parse(WAKE_STAMP)}`);
  });

  // TEST_SCENARIO: the Task is what the user is testing, so an on-demand fire carries the same payload a scheduled one does — the Agent's trigger handler cannot tell the two apart and picks the session mode and Precheck from it as usual.
  it("carries the same trigger payload a scheduled fire carries", async () => {
    const { runner, payloads } = makeDeps({
      precheck: "test -f /tmp/ready",
      lastRun: "2026-06-12T09:00:00.000Z",
    });

    await runner.runNow(SCHEDULE_ID);

    expect(payloads[0]).toMatchObject({
      scheduleId: SCHEDULE_ID,
      task: "do the thing",
      precheck: "test -f /tmp/ready",
      fireAt: WAKE_STAMP,
      lastRunAt: "2026-06-12T09:00:00.000Z",
    });
  });

  // TEST_SCENARIO: a paused Schedule is the one most likely to be under construction, and enabling it just to try it would move its next occurrence — the thing the action exists to avoid. So the disabled check that drops a scheduled fire does not apply here.
  it("runs a disabled schedule", async () => {
    const { runner, calls } = makeDeps({ enabled: false });

    await expect(runner.runNow(SCHEDULE_ID)).resolves.toBe("started");

    expect(calls).toContain(`bump:${AGENT_ID}`);
  });

  // TEST_SCENARIO: a run that happened is what the Precheck's "anything new since last time?" measures from, so an on-demand run stamps the last-run pair like any other run — otherwise the next Precheck is told work happened longer ago than it did and finds the same work twice.
  it("stamps the run as the last run when there is no precheck", async () => {
    const { runner, stampedFires, fires, nextRuns } = makeDeps();

    await runner.runNow(SCHEDULE_ID);

    expect(stampedFires).toEqual(["success"]);
    expect(fires).toEqual([]);
    expect(nextRuns).toEqual([]);
  });

  // TEST_SCENARIO: only the pod knows a Precheck's verdict, so claiming a run at send time would make an on-demand fire that declines read like one that ran — the same reason a scheduled prechecked fire records nothing until the report lands.
  it("leaves a prechecked run to its own verdict report", async () => {
    const { runner, patches, stampedFires } = makeDeps({
      precheck: "test -f /tmp/ready",
    });

    await runner.runNow(SCHEDULE_ID);

    expect(patches).toEqual([]);
    expect(stampedFires).toEqual([]);
  });

  // TEST_SCENARIO: the stamp the poke wrote is keyed by event id, so a declined on-demand run must restore activity the same way a declined occurrence does — otherwise trying a Schedule out holds its Agent awake.
  it("a declined on-demand run restores the activity stamp the poke wrote", async () => {
    const { runner, restored } = makeDeps({ precheck: "test -f /tmp/ready" });

    await runner.runNow(SCHEDULE_ID);
    await runner.reportFire({
      scheduleId: SCHEDULE_ID,
      eventId: `run:${SCHEDULE_ID}:${Date.parse(WAKE_STAMP)}`,
      ranPrecheck: "test -f /tmp/ready",
      outcome: "declined",
    });

    expect(restored).toEqual([
      { previous: "2026-06-12T09:00:00.000Z", written: WAKE_STAMP },
    ]);
  });

  // TEST_SCENARIO: an Agent from a Starter Kit whose onboarding has not finished cannot receive work yet. A scheduled fire is held silently because nobody is watching; here somebody is, so the refusal is reported instead of the fire vanishing.
  it("refuses while the agent has not finished onboarding", async () => {
    const { runner, calls } = makeDeps({ onboardingPending: true });

    await expect(runner.runNow(SCHEDULE_ID)).resolves.toBe(
      "onboarding-pending",
    );

    expect(calls).toEqual([]);
  });

  // TEST_SCENARIO: a fire that never committed is not a run, so it must leave the last-run record of the previous one standing — the user learns it failed from the error, not from a status the next Precheck would then measure from.
  it("records nothing when the outbox commit itself fails", async () => {
    const { runner, stampedFires, patches, fires, nextRuns } = makeDeps({
      bumpError: new Error("postgres unreachable"),
    });

    await expect(runner.runNow(SCHEDULE_ID)).rejects.toThrow(
      "postgres unreachable",
    );

    expect(stampedFires).toEqual([]);
    expect(patches).toEqual([]);
    expect(fires).toEqual([]);
    expect(nextRuns).toEqual([]);
  });

  // TEST_SCENARIO: once the event is committed the task runs when the Agent is Ready, so a poke that fails afterwards is still a run. Leaving it unstamped would make the next Precheck measure from the older stamp and re-cover a window this run already processed — the gap the scheduled path does not have, because its own failure path writes the stamp too.
  it("stamps the run when the poke fails after the commit, and reports the poke", async () => {
    const { runner, stampedFires, nextRuns } = makeDeps({
      wakeError: new Error("k8s api unreachable"),
    });

    await expect(runner.runNow(SCHEDULE_ID)).rejects.toThrow(
      "k8s api unreachable",
    );

    expect(stampedFires).toEqual(["k8s api unreachable"]);
    expect(nextRuns).toEqual([]);
  });

  // TEST_SCENARIO: the event is durable once the outbox commits and the cron sweep re-enqueues it, so an enqueue that fails afterwards is still a run and must be stamped like a failed poke.
  it("stamps the run when the enqueue fails after the commit", async () => {
    const { runner, stampedFires } = makeDeps({
      enqueueError: new Error("queue unreachable"),
    });

    await expect(runner.runNow(SCHEDULE_ID)).rejects.toThrow(
      "queue unreachable",
    );

    expect(stampedFires).toEqual(["queue unreachable"]);
  });

  // TEST_SCENARIO: a prechecked fire normally leaves the stamp to its verdict report, but a failed poke may mean no report ever arrives — so the failure is recorded against the fire rather than lost, exactly as a scheduled fire records its own.
  it("records a failed poke on a prechecked schedule too", async () => {
    const { runner, stampedFires } = makeDeps({
      precheck: "test -f /tmp/ready",
      wakeError: new Error("k8s api unreachable"),
    });

    await expect(runner.runNow(SCHEDULE_ID)).rejects.toThrow(
      "k8s api unreachable",
    );

    expect(stampedFires).toEqual(["k8s api unreachable"]);
  });
});
