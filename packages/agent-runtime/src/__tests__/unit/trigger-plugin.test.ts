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
      return { sessionId: "new-session" };
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
    log: () => {},
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
    expect(reports[0]).toEqual({
      eventId: ctx.eventId,
      outcome: "failed",
      detail: "precheck exited 127",
    });
  });
});
