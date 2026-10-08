import { describe, expect, it } from "vitest";
import type { ClientChannel } from "../../modules/acp/infrastructure/client-channel.js";
import type { AcpRuntime } from "../../modules/acp/services/acp-runtime/acp-runtime.js";
import { createTriggerSessionDriver } from "../../modules/acp/services/trigger-session-driver.js";

function fakeRuntime(): { runtime: AcpRuntime; sent: any[] } {
  const sent: any[] = [];
  const runtime: AcpRuntime = {
    attach(channel: ClientChannel) {
      channel.onMessage((data) => {
        const frame = JSON.parse(data);
        sent.push(frame);
        if (frame.method === "initialize") {
          channel.send(
            JSON.stringify({ jsonrpc: "2.0", id: frame.id, result: {} }),
          );
        } else if (frame.method === "_platform/session/pin_model") {
          channel.send(
            JSON.stringify({ jsonrpc: "2.0", id: frame.id, result: {} }),
          );
        } else if (frame.method === "session/resume") {
          channel.send(
            JSON.stringify({ jsonrpc: "2.0", id: frame.id, result: {} }),
          );
        } else if (frame.method === "session/new") {
          channel.send(
            JSON.stringify({
              jsonrpc: "2.0",
              id: frame.id,
              result: { sessionId: "s1" },
            }),
          );
        }
      });
    },
    isSessionRunning: () => false,
    sessionFrames: () => ({ frames: [], truncated: false }),
    status: () => ({
      idle: true,
      backgroundWork: [],
      keptProcesses: 0,
    }),
    resetSession: () => {},
    markSessionCold: () => {},
    releaseSession: () => {},
    holdsSessions: () => false,
    refreshEnv: () => {},
    recycleForConfig: () => {},
    harnessPid: () => null,
    activeTurnSince: () => null,
    pendingRestart: () => null,
    applyPendingRestart: () => false,
    onPendingRestartChange: () => {},
    shutdown: () => {},
  };
  return { runtime, sent };
}

describe("createTriggerSessionDriver", () => {
  it("stamps platformMeta into _meta.platform on session/new", async () => {
    const { runtime, sent } = fakeRuntime();
    const driver = createTriggerSessionDriver({ acpRuntime: runtime });

    const res = await driver.start({
      task: "do it",
      platformMeta: {
        type: "schedule_cron",
        mode: "chat",
        scheduleId: "sch-1",
      },
    });

    expect(res.sessionId).toBe("s1");
    const newFrame = sent.find((f) => f.method === "session/new");
    expect(newFrame.params._meta.platform).toEqual({
      type: "schedule_cron",
      mode: "chat",
      scheduleId: "sch-1",
    });
  });

  it("sends no _meta when platformMeta is omitted", async () => {
    const { runtime, sent } = fakeRuntime();
    const driver = createTriggerSessionDriver({ acpRuntime: runtime });

    await driver.start({ task: "do it" });

    const newFrame = sent.find((f) => f.method === "session/new");
    expect(newFrame.params._meta).toBeUndefined();
  });

  /** TEST_SCENARIO: A fire that names a model opens its session on that
   * model's process, through the session's own pair, and never switches a
   * live session's model inside its harness. */
  it("opens a new session on the fire's model", async () => {
    const { runtime, sent } = fakeRuntime();
    const driver = createTriggerSessionDriver({ acpRuntime: runtime });
    await driver.start({ task: "do it", model: "opus" });
    const newFrame = sent.find((f) => f.method === "session/new");
    expect(newFrame.params._meta.platform).toEqual({ model: "opus" });
    expect(
      sent.filter((f) => /set_model|set_config_option/.test(f.method ?? "")),
    ).toEqual([]);
  });

  /** TEST_SCENARIO: A continuous schedule resumes its session on the fire's
   * model by pinning the session to it before the resume. */
  it("pins a resumed session to the fire's model first", async () => {
    const { runtime, sent } = fakeRuntime();
    const driver = createTriggerSessionDriver({ acpRuntime: runtime });
    await driver.start({ task: "do it", resumeSessionId: "s0", model: "opus" });
    const methods = sent.map((f) => f.method).filter(Boolean);
    expect(methods.indexOf("_platform/session/pin_model")).toBeLessThan(
      methods.indexOf("session/resume"),
    );
    expect(
      sent.find((f) => f.method === "_platform/session/pin_model").params,
    ).toEqual({ sessionId: "s0", model: "opus" });
  });
});
