import { describe, expect, it } from "vitest";
import type { ClientChannel } from "../../modules/acp/infrastructure/client-channel.js";
import type { AcpRuntime } from "../../modules/acp/services/acp-runtime/acp-runtime.js";
import {
  createTriggerSessionDriver,
  NoSessionModelError,
} from "../../modules/acp/services/trigger-session-driver.js";

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
    prestart() {},
    isSessionRunning: () => false,
    toolCallsOpen: () => false,
    harnessBusy: () => false,
    sessionFrames: () => ({ frames: [], truncated: false }),
    status: () => ({
      idle: true,
      backgroundWork: [],
    }),
    resetSession: () => {},
    syncSessionSettings: () => {},
    markSessionCold: () => {},
    releaseSession: () => {},
    holdsSessions: () => false,
    refreshEnv: () => {},
    recycleForConfig: () => {},
    harnesses: () => [],
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
    const driver = createTriggerSessionDriver({
      acpRuntime: runtime,
      modelRequired: () => false,
      modelMissing: () => false,
    });

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
    const driver = createTriggerSessionDriver({
      acpRuntime: runtime,
      modelRequired: () => false,
      modelMissing: () => false,
    });

    await driver.start({ task: "do it" });

    const newFrame = sent.find((f) => f.method === "session/new");
    expect(newFrame.params._meta).toBeUndefined();
  });

  /** TEST_SCENARIO: A fire that names a model opens its session on that
   * model's process, through the session's own pair, and never switches a
   * live session's model inside its harness. */
  it("opens a new session on the fire's model", async () => {
    const { runtime, sent } = fakeRuntime();
    const driver = createTriggerSessionDriver({
      acpRuntime: runtime,
      modelRequired: () => false,
      modelMissing: () => false,
    });
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
    const driver = createTriggerSessionDriver({
      acpRuntime: runtime,
      modelRequired: () => false,
      modelMissing: () => false,
    });
    await driver.start({ task: "do it", resumeSessionId: "s0", model: "opus" });
    const methods = sent.map((f) => f.method).filter(Boolean);
    expect(methods.indexOf("_platform/session/pin_model")).toBeLessThan(
      methods.indexOf("session/resume"),
    );
    expect(
      sent.find((f) => f.method === "_platform/session/pin_model").params,
    ).toEqual({ sessionId: "s0", model: "opus" });
  });

  /** TEST_SCENARIO: On a harness that needs a model, a fire with none opens
   * no session, and a resumed session still without one gets no prompt; both
   * are refused with what to do, so no model the user never chose runs. */
  it("refuses a run that would start without a model", async () => {
    const { runtime, sent } = fakeRuntime();
    const driver = createTriggerSessionDriver({
      acpRuntime: runtime,
      modelRequired: () => true,
      modelMissing: () => true,
    });
    await expect(driver.start({ task: "do it" })).rejects.toBeInstanceOf(
      NoSessionModelError,
    );
    await expect(
      driver.start({ task: "do it", resumeSessionId: "s0" }),
    ).rejects.toThrow(/Providers page/);
    expect(sent.map((f) => f.method)).not.toContain("session/new");
    expect(sent.map((f) => f.method)).not.toContain("session/prompt");
  });

  /** TEST_SCENARIO: A one-time task continuing the session that scheduled it
   * keeps that session's own model, and pins the fire's model only on a
   * session that has none (one from before the Model Router). */
  it("pins a continued session only when it has no model", async () => {
    let missing = false;
    const { runtime, sent } = fakeRuntime();
    const driver = createTriggerSessionDriver({
      acpRuntime: runtime,
      modelRequired: () => false,
      modelMissing: () => missing,
    });
    const pins = () =>
      sent.filter((f) => f.method === "_platform/session/pin_model");
    await driver.start({
      task: "do it",
      resumeSessionId: "s0",
      model: "ibm/opus",
      keepSessionModel: true,
    });
    expect(pins()).toEqual([]);
    missing = true;
    await driver
      .start({
        task: "do it",
        resumeSessionId: "s0",
        model: "ibm/opus",
        keepSessionModel: true,
      })
      .catch(() => {});
    expect(pins().map((f) => f.params)).toEqual([
      { sessionId: "s0", model: "ibm/opus" },
    ]);
  });

  /** TEST_SCENARIO: a new Session whose model comes in its platform metadata
   * (kit setup, outcome turns) runs; a resumed Session with no model and none
   * to pin is refused before anything resumes it. */
  it("reads the model from the metadata and refuses before resuming", async () => {
    const { runtime, sent } = fakeRuntime();
    const driver = createTriggerSessionDriver({
      acpRuntime: runtime,
      modelRequired: () => true,
      modelMissing: () => true,
    });
    await driver.start({
      task: "set up",
      platformMeta: { mode: "chat", model: "ibm/opus" } as never,
    });
    expect(sent.map((f) => f.method)).toContain("session/new");
    sent.length = 0;
    await expect(
      driver.start({ task: "go on", resumeSessionId: "s0" }),
    ).rejects.toBeInstanceOf(NoSessionModelError);
    expect(sent.map((f) => f.method)).not.toContain("session/resume");
  });

  /** TEST_SCENARIO: A message from another Session is sent on the message
   * surface, which the runtime may steer into a turn in flight; a scheduled
   * fire stays on the schedule surface, which only queues. */
  it("marks a steered prompt with the message surface", async () => {
    const { runtime, sent } = fakeRuntime();
    const driver = createTriggerSessionDriver({
      acpRuntime: runtime,
      modelRequired: () => false,
      modelMissing: () => false,
    });

    await driver.start({
      task: "stop",
      resumeSessionId: "s0",
      unattended: true,
      steer: true,
    });
    await driver.start({
      task: "due",
      resumeSessionId: "s0",
      unattended: true,
    });

    const surfaces = sent
      .filter((f) => f.method === "session/prompt")
      .map((f) => f.params._meta?.platform?.surface);
    expect(surfaces).toEqual(["message", "schedule"]);
  });
});
