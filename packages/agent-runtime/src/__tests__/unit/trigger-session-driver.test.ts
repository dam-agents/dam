import { describe, expect, it } from "vitest";
import { NO_MODEL_REASON } from "agent-runtime-api";
import type { ClientChannel } from "../../modules/acp/infrastructure/client-channel.js";
import type { AcpRuntime } from "../../modules/acp/services/acp-runtime/acp-runtime.js";
import {
  createTriggerSessionDriver,
  NoSessionModelError,
} from "../../modules/acp/services/trigger-session-driver.js";

function fakeRuntime(opts: { refuses?: string; reason?: string } = {}): {
  runtime: AcpRuntime;
  sent: any[];
} {
  const sent: any[] = [];
  const runtime: AcpRuntime = {
    attach(channel: ClientChannel) {
      channel.onMessage((data) => {
        const frame = JSON.parse(data);
        sent.push(frame);
        if (frame.method === opts.refuses) {
          channel.send(
            JSON.stringify({
              jsonrpc: "2.0",
              id: frame.id,
              error: {
                code: -32001,
                message: "this model cannot serve this run",
                data: {
                  platform: { reason: opts.reason ?? NO_MODEL_REASON },
                },
              },
            }),
          );
        } else if (frame.method === "initialize") {
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
    hasSessionWork: () => false,
    toolCallsOpen: () => false,
    harnessBusy: () => false,
    sessionFrames: () => ({ frames: [], truncated: false, partial: false }),
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
      modelReady: async () => true,
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
      modelReady: async () => true,
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
      modelReady: async () => true,
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
      modelReady: async () => true,
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

  /** TEST_SCENARIO: A fire whose Session no provider can serve is refused by
   * the runtime, after its own bounded wait for a model, and the refusal says
   * a provider is what is missing rather than a model to pick; nothing is
   * prompted, so no model the user never chose runs. */
  it("refuses a run the runtime cannot find a model for", async () => {
    const { runtime, sent } = fakeRuntime({ refuses: "session/new" });
    const driver = createTriggerSessionDriver({
      acpRuntime: runtime,
      modelReady: async () => true,
      modelMissing: () => true,
    });
    await expect(driver.start({ task: "do it" })).rejects.toThrow(
      /no model provider that serves this session/,
    );
    expect(sent.map((f) => f.method)).not.toContain("session/prompt");

    const resuming = fakeRuntime({ refuses: "session/resume" });
    const other = createTriggerSessionDriver({
      acpRuntime: resuming.runtime,
      modelReady: async () => true,
      modelMissing: () => true,
    });
    await expect(
      other.start({ task: "do it", resumeSessionId: "s0" }),
    ).rejects.toBeInstanceOf(NoSessionModelError);
    expect(resuming.sent.map((f) => f.method)).not.toContain("session/prompt");
  });

  /** TEST_SCENARIO: A resumed scheduled Session whose model its provider lost
   * is no longer refused before the resume: the lease router resolves another
   * model from the agent's catalog, or says that nothing can serve it, and
   * the fire runs on that model. */
  it("runs a resumed session with a revoked model instead of throwing", async () => {
    const { runtime, sent } = fakeRuntime();
    const driver = createTriggerSessionDriver({
      acpRuntime: runtime,
      modelReady: async () => true,
      modelMissing: () => true,
    });
    const res = await driver.start({
      task: "due",
      resumeSessionId: "s0",
      unattended: true,
    });
    expect(res.sessionId).toBe("s0");
    expect(sent.map((f) => f.method)).toEqual([
      "initialize",
      "session/resume",
      "session/prompt",
    ]);
  });

  /** TEST_SCENARIO: A fire pins the model it names, but that model may belong
   * to a provider the agent lost or that no listing holds, and the lease
   * router then resolves one that serves; so the refused pin is logged and
   * the run goes on to the router's model instead of failing. */
  it("runs on the router's model when a fire's pin is refused", async () => {
    const logged: string[] = [];
    const { runtime, sent } = fakeRuntime({
      refuses: "_platform/session/pin_model",
      reason: "provider-removed",
    });
    const driver = createTriggerSessionDriver({
      acpRuntime: runtime,
      modelMissing: () => true,
      modelReady: async () => true,
      log: (msg) => logged.push(msg),
    });
    const res = await driver.start({
      task: "due",
      resumeSessionId: "s0",
      model: "cb/glm",
    });
    expect(res.sessionId).toBe("s0");
    expect(sent.map((f) => f.method)).toEqual([
      "initialize",
      "_platform/session/pin_model",
      "session/resume",
      "session/prompt",
    ]);
    expect(logged).toHaveLength(1);
    expect(logged[0]).toContain("cb/glm");
  });

  /** TEST_SCENARIO: A prompt the runtime would hold must not be sent before a
   * model serves the Session, since the driver closes its connection as soon
   * as it returns and a held prompt would be dropped when released; so the
   * fire waits on the runtime's model readiness first. */
  it("prompts only once the runtime finds a model", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { runtime, sent } = fakeRuntime();
    const driver = createTriggerSessionDriver({
      acpRuntime: runtime,
      modelMissing: () => true,
      modelReady: async () => {
        await gate;
        return true;
      },
    });
    const started = driver.start({ task: "due", resumeSessionId: "s0" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(sent.map((f) => f.method)).not.toContain("session/prompt");
    release();
    await started;
    expect(sent.map((f) => f.method)).toContain("session/prompt");
  });

  /** TEST_SCENARIO: A fire whose Session the runtime never finds a model for
   * is refused after that wait, with the copy that names a provider as what
   * is missing, and nothing is prompted. */
  it("refuses the run when no model serves it in time", async () => {
    const { runtime, sent } = fakeRuntime();
    const driver = createTriggerSessionDriver({
      acpRuntime: runtime,
      modelMissing: () => true,
      modelReady: async () => false,
    });
    await expect(
      driver.start({ task: "due", resumeSessionId: "s0" }),
    ).rejects.toThrow(/no model provider that serves this session/);
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
      modelReady: async () => true,
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
   * to pin reaches the runtime, which answers the resume with its no-model
   * refusal once nothing can serve. */
  it("reads the model from the metadata and refuses a resume the runtime cannot serve", async () => {
    const { runtime, sent } = fakeRuntime();
    const driver = createTriggerSessionDriver({
      acpRuntime: runtime,
      modelReady: async () => true,
      modelMissing: () => true,
    });
    await driver.start({
      task: "set up",
      platformMeta: { mode: "chat", model: "ibm/opus" } as never,
    });
    expect(sent.map((f) => f.method)).toContain("session/new");

    const resuming = fakeRuntime({ refuses: "session/resume" });
    const other = createTriggerSessionDriver({
      acpRuntime: resuming.runtime,
      modelReady: async () => true,
      modelMissing: () => true,
    });
    await expect(
      other.start({ task: "go on", resumeSessionId: "s0" }),
    ).rejects.toBeInstanceOf(NoSessionModelError);
    expect(resuming.sent.map((f) => f.method)).toContain("session/resume");
    expect(resuming.sent.map((f) => f.method)).not.toContain("session/prompt");
  });

  /** TEST_SCENARIO: A message from another Session is sent on the message
   * surface, which the runtime may steer into a turn in flight; a scheduled
   * fire stays on the schedule surface, which only queues. */
  it("marks a steered prompt with the message surface", async () => {
    const { runtime, sent } = fakeRuntime();
    const driver = createTriggerSessionDriver({
      acpRuntime: runtime,
      modelReady: async () => true,
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
