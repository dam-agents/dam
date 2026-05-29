import { SessionMode, SessionType } from "api-server-api";
import { describe, expect, it, vi } from "vitest";
import type { TriggerSessionDriver } from "../../modules/acp/index.js";
import { createTriggerImpl } from "../../modules/runtime-channel/drivers/trigger-impl.js";
import type { TriggerStateStore } from "../../modules/runtime-channel/infrastructure/trigger-state-store.js";

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

describe("createTriggerImpl", () => {
  it("stamps schedule platform metadata on a fresh-mode session", async () => {
    const { driver, calls } = fakeDriver();
    const stateStore: TriggerStateStore = {
      getSessionForSchedule: () => undefined,
      setSessionForSchedule: vi.fn(),
      clearSessionForSchedule: vi.fn(),
    };
    const impl = createTriggerImpl({ driver, stateStore });

    await impl.handle({
      scheduleId: "sch-1",
      task: "do it",
      sessionMode: "fresh",
    });

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
    const impl = createTriggerImpl({ driver, stateStore });

    await impl.handle({
      scheduleId: "sch-2",
      task: "do it",
      sessionMode: "continuous",
    });

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
    const impl = createTriggerImpl({ driver, stateStore });

    await impl.handle({
      scheduleId: "sch-3",
      task: "do it",
      sessionMode: "continuous",
    });

    expect(calls[0]?.resumeSessionId).toBe("prior-session");
    expect(calls[0]?.platformMeta).toBeUndefined();
  });

  it("reset clears the schedule's continuous binding", () => {
    const { driver } = fakeDriver();
    const clearSessionForSchedule = vi.fn();
    const stateStore: TriggerStateStore = {
      getSessionForSchedule: () => undefined,
      setSessionForSchedule: vi.fn(),
      clearSessionForSchedule,
    };
    const impl = createTriggerImpl({ driver, stateStore });

    impl.reset("sch-9");

    expect(clearSessionForSchedule).toHaveBeenCalledWith("sch-9");
  });
});
