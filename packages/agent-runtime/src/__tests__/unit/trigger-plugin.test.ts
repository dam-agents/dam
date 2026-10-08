import { SessionMode, SessionType } from "api-server-api";
import { describe, expect, it, vi } from "vitest";
import type { EventContext } from "agent-runtime-api";
import type { TriggerSessionDriver } from "../../modules/acp/index.js";
import {
  createTriggerPlugin,
  type EventReporter,
} from "../../modules/runtime-channel/drivers/trigger-plugin.js";
import type { PrecheckRunner } from "../../modules/runtime-channel/infrastructure/precheck-runner.js";
import type { TriggerStateStore } from "../../modules/runtime-channel/infrastructure/trigger-state-store.js";

const ctx: EventContext = {
  eventId: "evt-1:1",
  agentHome: "",
  pluginStateDir: "",
  log: () => {},
};

function fakeDriver() {
  const calls: Parameters<TriggerSessionDriver["start"]>[0][] = [];
  const driver: TriggerSessionDriver = {
    async start(opts) {
      calls.push(opts);
      return { sessionId: "new-session", openedOn: null };
    },
  };
  return { driver, calls };
}

const scheduleMeta = (scheduleId: string) => ({
  type: SessionType.ScheduleCron,
  mode: SessionMode.Chat,
  scheduleId,
});

const allows: PrecheckRunner = async () => ({ verdict: "allowed" });

const handlerFor = (
  deps: {
    driver: TriggerSessionDriver;
    stateStore: TriggerStateStore;
    runPrecheck?: PrecheckRunner;
    reporter?: EventReporter;
  },
  kind: string,
) =>
  createTriggerPlugin({
    runPrecheck: allows,
    harnessDefault: async () => null,
    log: () => {},
    reporter: { report: async () => {} },
    ...deps,
  }).bindEvent!(kind, { impl: "trigger" });

describe("trigger plugin", () => {
  it("stamps schedule platform metadata on a fresh-mode session", async () => {
    const { driver, calls } = fakeDriver();
    const stateStore: TriggerStateStore = {
      getSessionForSchedule: () => undefined,
      setSessionForSchedule: vi.fn(),
      clearSessionForSchedule: vi.fn(),
    };
    await handlerFor({ driver, stateStore }, "trigger")(
      { scheduleId: "sch-1", task: "do it", sessionMode: "fresh" },
      ctx,
    );
    expect(calls[0]?.platformMeta).toEqual(scheduleMeta("sch-1"));
    expect(calls[0]?.resumeSessionId).toBeUndefined();
  });

  it("names a fresh session with the schedule's session title", async () => {
    const { driver, calls } = fakeDriver();
    const stateStore: TriggerStateStore = {
      getSessionForSchedule: () => undefined,
      setSessionForSchedule: vi.fn(),
      clearSessionForSchedule: vi.fn(),
    };
    await handlerFor({ driver, stateStore }, "trigger")(
      { scheduleId: "sch-1", task: "do it", sessionTitle: "Daily brief" },
      ctx,
    );
    expect(calls[0]?.platformMeta).toEqual({
      ...scheduleMeta("sch-1"),
      title: "Daily brief",
    });
  });

  it("stamps metadata and records the session when continuous mode first fires", async () => {
    const { driver, calls } = fakeDriver();
    const setSessionForSchedule = vi.fn();
    const stateStore: TriggerStateStore = {
      getSessionForSchedule: () => undefined,
      setSessionForSchedule,
      clearSessionForSchedule: vi.fn(),
    };
    await handlerFor({ driver, stateStore }, "trigger")(
      { scheduleId: "sch-2", task: "do it", sessionMode: "continuous" },
      ctx,
    );
    expect(calls[0]?.platformMeta).toEqual(scheduleMeta("sch-2"));
    expect(setSessionForSchedule).toHaveBeenCalledWith("sch-2", "new-session");
  });

  it("resumes a prior continuous session without minting a new one", async () => {
    const { driver, calls } = fakeDriver();
    const stateStore: TriggerStateStore = {
      getSessionForSchedule: () => "prior-session",
      setSessionForSchedule: vi.fn(),
      clearSessionForSchedule: vi.fn(),
    };
    await handlerFor({ driver, stateStore }, "trigger")(
      { scheduleId: "sch-3", task: "do it", sessionMode: "continuous" },
      ctx,
    );
    expect(calls[0]?.resumeSessionId).toBe("prior-session");
    expect(calls[0]?.platformMeta).toBeUndefined();
  });

  it("schedule-reset clears the schedule's continuous binding", async () => {
    const { driver } = fakeDriver();
    const clearSessionForSchedule = vi.fn();
    const stateStore: TriggerStateStore = {
      getSessionForSchedule: () => undefined,
      setSessionForSchedule: vi.fn(),
      clearSessionForSchedule,
    };
    await handlerFor({ driver, stateStore }, "schedule-reset")(
      { scheduleId: "sch-9" },
      ctx,
    );
    expect(clearSessionForSchedule).toHaveBeenCalledWith("sch-9");
  });
});

describe("trigger plugin precheck", () => {
  const idleStore = (): TriggerStateStore => ({
    getSessionForSchedule: () => undefined,
    setSessionForSchedule: vi.fn(),
    clearSessionForSchedule: vi.fn(),
  });

  const recorder = () => {
    const reports: Parameters<EventReporter["report"]>[0][] = [];
    return {
      reports,
      reporter: {
        report: async (input: Parameters<EventReporter["report"]>[0]) => {
          reports.push(input);
        },
      },
    };
  };

  const payload = {
    scheduleId: "sch-1",
    task: "do it",
    precheck: "anything",
    fireAt: "2026-06-12T10:30:00.000Z",
  };

  // TEST_SCENARIO: the handler runs behind the per-agent applyState lock, so awaiting a two-minute Precheck there stops everything else reaching the agent.
  it("returns before the precheck finishes, then reports and runs", async () => {
    const { driver, calls } = fakeDriver();
    const { reports, reporter } = recorder();
    let release!: () => void;
    const started = new Promise<void>((r) => (release = r));

    await handlerFor(
      {
        driver,
        stateStore: idleStore(),
        reporter,
        runPrecheck: async () => {
          await started;
          return { verdict: "allowed", context: "PR 7 landed" };
        },
      },
      "trigger",
    )(payload, ctx);

    expect(calls).toHaveLength(0);
    expect(reports).toHaveLength(0);

    release();
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    expect(reports[0]).toEqual({ eventId: ctx.eventId, outcome: "ok" });
    expect(calls[0]?.task).toBe("do it\n\n---\nPrecheck output:\nPR 7 landed");
  });

  // TEST_SCENARIO: exit 1 means nothing changed, so no Session opens and only the pod can tell the platform it declined.
  it("opens no session when the precheck declines the fire", async () => {
    const { driver, calls } = fakeDriver();
    const { reports, reporter } = recorder();

    await handlerFor(
      {
        driver,
        stateStore: idleStore(),
        reporter,
        runPrecheck: async () => ({ verdict: "declined" }),
      },
      "trigger",
    )(payload, ctx);

    await vi.waitFor(() => expect(reports).toHaveLength(1));
    expect(reports[0]).toEqual({ eventId: ctx.eventId, outcome: "declined" });
    expect(calls).toHaveLength(0);
  });

  // TEST_SCENARIO: a Precheck that cannot run is the check breaking, not saying no, so the run goes ahead and the reason is reported.
  it("runs the task anyway when the precheck itself breaks", async () => {
    const { driver, calls } = fakeDriver();
    const { reports, reporter } = recorder();

    await handlerFor(
      {
        driver,
        stateStore: idleStore(),
        reporter,
        runPrecheck: async () => ({
          verdict: "precheck-failed",
          detail: "precheck exited 127",
        }),
      },
      "trigger",
    )(payload, ctx);

    await vi.waitFor(() => expect(calls).toHaveLength(1));
    await vi.waitFor(() => expect(reports).toHaveLength(1));
    expect(reports[0]).toEqual({
      eventId: ctx.eventId,
      outcome: "failed",
      detail: "precheck exited 127",
    });
  });
});

describe("trigger plugin one-time tasks", () => {
  const idleStore = (): TriggerStateStore => ({
    getSessionForSchedule: () => undefined,
    setSessionForSchedule: vi.fn(),
    clearSessionForSchedule: vi.fn(),
  });
  const origin = {
    sessionRef: "ref-1",
    mode: "continue" as const,
    name: "check back",
  };

  // TEST_SCENARIO: a task that continues its scheduling Session is a new unattended turn in that Session, found by the reference the platform tool recorded; when that Session is gone the task runs fresh rather than being lost.
  it("continues the scheduling session by its reference, or runs fresh when it is gone", async () => {
    const { driver, calls } = fakeDriver();
    const plugin = (found: string | undefined) =>
      createTriggerPlugin({
        driver,
        stateStore: idleStore(),
        runPrecheck: allows,
        log: () => {},
        reporter: { report: async () => {} },
        findSessionByRef: () => found,
      }).bindEvent!("trigger", { impl: "trigger" });
    const payload = {
      scheduleId: "sch-1",
      task: "do it",
      once: true as const,
      origin,
    };

    await plugin("origin-session")(payload, ctx);
    await plugin(undefined)(payload, ctx);

    expect(calls[0]).toMatchObject({
      resumeSessionId: "origin-session",
      unattended: true,
      task: expect.stringContaining("do it"),
    });
    expect(calls[0]?.platformMeta).toBeUndefined();
    expect(calls[1]?.resumeSessionId).toBeUndefined();
    expect(calls[1]?.platformMeta).toMatchObject({
      type: SessionType.ScheduleOnce,
      scheduleId: "sch-1",
    });
  });

  // TEST_SCENARIO: a task that reports back runs fresh and carries the scheduling Session's reference in its metadata, which is what the runtime reads when the turn ends to hand the result over.
  it("marks a report-back task's fresh session with where its result goes", async () => {
    const { driver, calls } = fakeDriver();
    await handlerFor({ driver, stateStore: idleStore() }, "trigger")(
      {
        scheduleId: "sch-2",
        task: "do it",
        once: true,
        model: "haiku",
        origin: { ...origin, mode: "report" },
      },
      ctx,
    );
    expect(calls[0]).toMatchObject({
      model: "haiku",
      platformMeta: {
        type: SessionType.ScheduleOnce,
        scheduleId: "sch-2",
        reportTo: "ref-1",
        reportName: "check back",
      },
    });
    expect(calls[0]?.resumeSessionId).toBeUndefined();
  });
});
