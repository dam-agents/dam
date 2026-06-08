import { describe, expect, it } from "vitest";
import type { ClientChannel } from "../../modules/acp/infrastructure/client-channel.js";
import type { AcpRuntime } from "../../modules/acp/services/acp-runtime.js";
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
    status: () => ({
      activeClientCount: 0,
      pendingRequestCount: 0,
      queuedPromptCount: 0,
      agentAlive: true,
    }),
    resetSession: () => {},
    refreshEnv: () => {},
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
});
