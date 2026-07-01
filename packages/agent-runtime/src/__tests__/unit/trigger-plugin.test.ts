import { SessionMode, SessionType } from "api-server-api";
import { describe, expect, it, vi } from "vitest";
import type { DispatchContext } from "agent-runtime-api";
import type { TriggerSessionDriver } from "../../modules/acp/index.js";
import { createTriggerPlugin } from "../../modules/runtime-channel/drivers/trigger-plugin.js";
import type { TriggerStateStore } from "../../modules/runtime-channel/infrastructure/trigger-state-store.js";

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
  deps: { driver: TriggerSessionDriver; stateStore: TriggerStateStore },
  kind: string,
) => createTriggerPlugin(deps).bindEvent!(kind, { impl: "trigger" });

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
