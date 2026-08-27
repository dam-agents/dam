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

const artifactMeta = (artifactId: string) => ({
  type: SessionType.Artifact,
  mode: SessionMode.Chat,
  artifactId,
});

function fakeStateStore(
  bindings: {
    schedules?: Record<string, string>;
    artifacts?: Record<string, string>;
  } = {},
): TriggerStateStore {
  const schedules = { ...bindings.schedules };
  const artifacts = { ...bindings.artifacts };
  return {
    getSessionForSchedule: (id) => schedules[id],
    setSessionForSchedule: vi.fn((id, sid) => {
      schedules[id] = sid;
    }),
    clearSessionForSchedule: vi.fn(),
    getSessionForArtifact: (id) => artifacts[id],
    setSessionForArtifact: vi.fn((id, sid) => {
      artifacts[id] = sid;
    }),
    clearSessionForArtifact: vi.fn(),
  };
}

const handlerFor = (
  deps: { driver: TriggerSessionDriver; stateStore: TriggerStateStore },
  kind: string,
) => createTriggerPlugin(deps).bindEvent!(kind, { impl: "trigger" });

describe("trigger plugin", () => {
  it("stamps schedule platform metadata on a fresh-mode session", async () => {
    const { driver, calls } = fakeDriver();
    const stateStore = fakeStateStore();
    await handlerFor({ driver, stateStore }, "trigger")(
      { scheduleId: "sch-1", task: "do it", sessionMode: "fresh" },
      ctx,
    );
    expect(calls[0]?.platformMeta).toEqual(scheduleMeta("sch-1"));
    expect(calls[0]?.resumeSessionId).toBeUndefined();
  });

  it("stamps metadata and records the session when continuous mode first fires", async () => {
    const { driver, calls } = fakeDriver();
    const stateStore = fakeStateStore();
    await handlerFor({ driver, stateStore }, "trigger")(
      { scheduleId: "sch-2", task: "do it", sessionMode: "continuous" },
      ctx,
    );
    expect(calls[0]?.platformMeta).toEqual(scheduleMeta("sch-2"));
    expect(stateStore.setSessionForSchedule).toHaveBeenCalledWith(
      "sch-2",
      "new-session",
    );
  });

  it("resumes a prior continuous session without minting a new one", async () => {
    const { driver, calls } = fakeDriver();
    const stateStore = fakeStateStore({
      schedules: { "sch-3": "prior-session" },
    });
    await handlerFor({ driver, stateStore }, "trigger")(
      { scheduleId: "sch-3", task: "do it", sessionMode: "continuous" },
      ctx,
    );
    expect(calls[0]?.resumeSessionId).toBe("prior-session");
    expect(calls[0]?.platformMeta).toBeUndefined();
  });

  it("schedule-reset clears the schedule's continuous binding", async () => {
    const { driver } = fakeDriver();
    const stateStore = fakeStateStore();
    await handlerFor({ driver, stateStore }, "schedule-reset")(
      { scheduleId: "sch-9" },
      ctx,
    );
    expect(stateStore.clearSessionForSchedule).toHaveBeenCalledWith("sch-9");
  });

  it("opens an artifact-tagged session on an artifact's first request", async () => {
    const { driver, calls } = fakeDriver();
    const stateStore = fakeStateStore();
    await handlerFor({ driver, stateStore }, "artifact-request")(
      { requestId: "req-1", artifactId: "art-1", task: "refresh it" },
      ctx,
    );
    expect(calls[0]?.task).toBe("refresh it");
    expect(calls[0]?.platformMeta).toEqual(artifactMeta("art-1"));
    expect(calls[0]?.resumeSessionId).toBeUndefined();
    expect(stateStore.setSessionForArtifact).toHaveBeenCalledWith(
      "art-1",
      "new-session",
    );
  });

  it("resumes the same session for a second request on the same artifact", async () => {
    const { driver, calls } = fakeDriver();
    const stateStore = fakeStateStore({
      artifacts: { "art-2": "artifact-session" },
    });
    await handlerFor({ driver, stateStore }, "artifact-request")(
      { requestId: "req-2", artifactId: "art-2", task: "refresh it again" },
      ctx,
    );
    expect(calls[0]?.resumeSessionId).toBe("artifact-session");
    expect(calls[0]?.platformMeta).toBeUndefined();
    expect(stateStore.setSessionForArtifact).not.toHaveBeenCalled();
  });

  it("keeps a different artifact on its own session", async () => {
    const { driver, calls } = fakeDriver();
    const stateStore = fakeStateStore({
      artifacts: { "art-2": "artifact-session" },
    });
    await handlerFor({ driver, stateStore }, "artifact-request")(
      { requestId: "req-3", artifactId: "art-3", task: "refresh it" },
      ctx,
    );
    expect(calls[0]?.resumeSessionId).toBeUndefined();
    expect(calls[0]?.platformMeta).toEqual(artifactMeta("art-3"));
    expect(stateStore.setSessionForArtifact).toHaveBeenCalledWith(
      "art-3",
      "new-session",
    );
  });

  it("refuses an event kind it does not handle", () => {
    const { driver } = fakeDriver();
    expect(() =>
      handlerFor({ driver, stateStore: fakeStateStore() }, "workspace-seed"),
    ).toThrow(/does not handle event kind/);
  });
});
