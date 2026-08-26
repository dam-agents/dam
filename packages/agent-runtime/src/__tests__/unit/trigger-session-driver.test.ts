import { describe, expect, it } from "vitest";
import type { ClientChannel } from "../../modules/acp/infrastructure/client-channel.js";
import type { AcpRuntime } from "../../modules/acp/services/acp-runtime/acp-runtime.js";
import { createTriggerSessionDriver } from "../../modules/acp/services/trigger-session-driver.js";

function fakeRuntime(): {
  runtime: AcpRuntime;
  sent: any[];
  channel: () => ClientChannel;
  answerPrompt: () => void;
} {
  const sent: any[] = [];
  let attached: ClientChannel | null = null;
  let promptId: number | null = null;
  const runtime: AcpRuntime = {
    attach(channel: ClientChannel) {
      attached = channel;
      channel.onMessage((data) => {
        const frame = JSON.parse(data);
        sent.push(frame);
        if (frame.method === "initialize") {
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
        } else if (frame.method === "session/resume") {
          channel.send(
            JSON.stringify({ jsonrpc: "2.0", id: frame.id, result: {} }),
          );
        } else if (frame.method === "session/prompt") {
          promptId = frame.id;
        }
      });
    },
    status: () => ({
      idle: true,
      backgroundWork: [],
    }),
    resetSession: () => {},
    refreshEnv: () => {},
    shutdown: () => {},
  };
  return {
    runtime,
    sent,
    channel: () => attached!,
    answerPrompt: () =>
      attached!.send(
        JSON.stringify({ jsonrpc: "2.0", id: promptId, result: {} }),
      ),
  };
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
});

// TEST_SCENARIO: A resumed session is served from the platform's own history, which marks it cold, so the runtime holds the prompt until the harness has loaded the session again. The prompt belongs to the channel that sent it, so closing the channel at that moment throws the prompt away and the turn never runs. The channel must stay open until the turn answers.
describe("handing the prompt over", () => {
  it("keeps the channel open until the prompt is answered", async () => {
    const { runtime, sent, channel, answerPrompt } = fakeRuntime();
    const driver = createTriggerSessionDriver({ acpRuntime: runtime });

    await driver.start({ task: "do it", resumeSessionId: "s1" });

    expect(sent.map((f) => f.method)).toEqual([
      "initialize",
      "session/resume",
      "session/prompt",
    ]);
    expect(channel().isOpen()).toBe(true);

    answerPrompt();
    expect(channel().isOpen()).toBe(false);
  });

  it("closes the channel when the session cannot be reached", async () => {
    const sent: any[] = [];
    let attached: ClientChannel | null = null;
    const runtime: AcpRuntime = {
      attach(ch: ClientChannel) {
        attached = ch;
        ch.onMessage((data) => {
          const frame = JSON.parse(data);
          sent.push(frame);
          ch.send(
            JSON.stringify({
              jsonrpc: "2.0",
              id: frame.id,
              error: { message: "no such session" },
            }),
          );
        });
      },
      status: () => ({ idle: true, backgroundWork: [] }),
      resetSession: () => {},
      refreshEnv: () => {},
      shutdown: () => {},
    };
    const driver = createTriggerSessionDriver({ acpRuntime: runtime });

    await expect(driver.start({ task: "do it" })).rejects.toThrow(
      /no such session/,
    );
    expect(attached!.isOpen()).toBe(false);
  });
});
