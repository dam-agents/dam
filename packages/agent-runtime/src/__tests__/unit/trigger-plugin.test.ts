import { SessionMode, SessionType } from "api-server-api";
import { describe, expect, it, vi } from "vitest";
import type { DispatchContext } from "agent-runtime-api";
import type { TriggerSessionDriver } from "../../modules/acp/index.js";
import {
  createTriggerPlugin,
  type FireReporter,
} from "../../modules/runtime-channel/drivers/trigger-plugin.js";
import type { TriggerStateStore } from "../../modules/runtime-channel/infrastructure/trigger-state-store.js";

const SPAWN_TIMEOUT_MS = 30_000;

const ctx: DispatchContext = {
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

const handlerFor = (
  deps: {
    driver: TriggerSessionDriver;
    stateStore: TriggerStateStore;
    reporter?: FireReporter;
  },
  kind: string,
) =>
  createTriggerPlugin({ workDir: ".", log: () => {}, ...deps }).bindEvent!(
    kind,
    { impl: "trigger" },
  );

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
    const reports: Parameters<FireReporter["report"]>[0][] = [];
    return {
      reports,
      reporter: {
        report: async (input: Parameters<FireReporter["report"]>[0]) => {
          reports.push(input);
        },
      },
    };
  };

  // TEST_SCENARIO: exit 1 is the Precheck saying nothing changed — no Session may open, and the platform has to hear about the Declined Fire because only the pod knows it happened.
  it(
    "opens no session when the precheck declines the fire",
    async () => {
      const { driver, calls } = fakeDriver();
      const { reports, reporter } = recorder();

      await handlerFor(
        { driver, stateStore: idleStore(), reporter },
        "trigger",
      )(
        {
          scheduleId: "sch-1",
          task: "do it",
          precheck: "exit 1",
          fireAt: "2026-06-12T10:30:00.000Z",
        },
        ctx,
      );

      expect(calls).toHaveLength(0);
      expect(reports[0]).toMatchObject({ verdict: "declined" });
    },
    SPAWN_TIMEOUT_MS,
  );

  // TEST_SCENARIO: a Precheck that cannot run at all is the check breaking, not saying no — the run goes ahead so work never stops silently, and the error is reported so the break stays visible.
  it(
    "runs the task anyway when the precheck itself breaks",
    async () => {
      const { driver, calls } = fakeDriver();
      const { reports, reporter } = recorder();

      await handlerFor(
        { driver, stateStore: idleStore(), reporter },
        "trigger",
      )(
        {
          scheduleId: "sch-1",
          task: "do it",
          precheck: "exit 127",
          fireAt: "2026-06-12T10:30:00.000Z",
        },
        ctx,
      );

      expect(calls).toHaveLength(1);
      expect(reports[0]).toMatchObject({ verdict: "precheck-failed" });
    },
    SPAWN_TIMEOUT_MS,
  );

  // TEST_SCENARIO: the cheap check already found what the expensive turn would look for, so its stdout rides along with the task instead of being derived a second time.
  it(
    "appends the precheck output to the task it allows",
    async () => {
      const { driver, calls } = fakeDriver();

      await handlerFor({ driver, stateStore: idleStore() }, "trigger")(
        {
          scheduleId: "sch-1",
          task: "review it",
          precheck: "echo 'PR 7 landed'",
          fireAt: "2026-06-12T10:30:00.000Z",
        },
        ctx,
      );

      expect(calls[0]?.task).toBe(
        "review it\n\n---\nPrecheck output:\nPR 7 landed",
      );
    },
    SPAWN_TIMEOUT_MS,
  );
});
