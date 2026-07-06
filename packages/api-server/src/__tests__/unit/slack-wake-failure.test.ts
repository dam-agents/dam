import { describe, it, expect } from "vitest";
import type { AgentsService } from "api-server-api";
import { createSlackWorker } from "../../modules/channels/infrastructure/slack.js";
import { createFakeSlackGateway } from "../../modules/channels/infrastructure/fake-slack-gateway.js";
import type { AcpClient } from "../../core/acp-client.js";
import type { DomainEvent } from "../../events.js";
import { EventType } from "../../events.js";
import { AgentWakeTimeoutError } from "../../modules/agents/index.js";
import type { StoredChannelConfig } from "../../modules/channels/stored-channel.js";

const OWNER = "kc|owner-1";

function wakeError(
  failure: AgentWakeTimeoutError["failure"],
): AgentWakeTimeoutError {
  return new AgentWakeTimeoutError({
    agentId: "agent-1",
    timeoutMs: 120_000,
    durationMs: 120_100,
    failure,
  });
}

function harness(ensureReady: AgentsService["ensureReady"]) {
  const gw = createFakeSlackGateway();
  const events: DomainEvent[] = [];
  const acp: AcpClient = {
    listSessions: async () => [],
    sendPrompt: async () => "the answer",
    triggerSession: () => Promise.reject(new Error("unused")),
  };
  const agents = {
    ensureReady,
    isAllowedUser: async () => false,
  } as unknown as AgentsService;

  const worker = createSlackWorker(
    () => acp,
    () => gw,
    () => agents,
    { resolve: async () => OWNER } as never,
    { authUrl: "http://kc", clientId: "c" } as never,
    new Map(),
    async () => OWNER,
    { resolveInstanceBySlackChannel: async () => "agent-1" } as never,
    "dam",
    async () => true,
    "http://ui",
    () => acp,
    (e) => events.push(e),
  );

  return {
    gw,
    events,
    async mention() {
      await worker.start("agent-1", {} as StoredChannelConfig);
      await gw.fireMention({
        user: "U1",
        channel: "C1",
        ts: "1.1",
        text: "hi agent",
      });
    },
    texts: () => gw.readOutbound().map((r) => ("text" in r ? r.text : "")),
    turnEvents: () =>
      events.filter((e) => e.type === EventType.ChannelTurnRelayed),
  };
}

describe("slack wake-failure surfacing", () => {
  it("cold wake: posts the waking ephemeral once and then answers", async () => {
    const h = harness(async (_id, opts) => {
      opts?.onWaking?.();
    });
    await h.mention();

    const ephemerals = h.gw
      .readOutbound()
      .filter((r) => r.kind === "ephemeral");
    expect(
      ephemerals.filter((r) => r.text.includes("Waking the agent")),
    ).toHaveLength(1);
    expect(h.texts()).toContain("the answer");
  });

  it("hard failure: posts human copy, never the internal error string", async () => {
    const h = harness(async () => {
      throw wakeError({
        kind: "agent-pod-failed",
        terminationReason: "ImagePullFailure",
      });
    });
    await h.mention();

    const joined = h.texts().join("\n");
    expect(joined).toContain("its image can't be pulled");
    expect(joined).not.toContain("did not become ready within");
    expect(h.turnEvents()).toHaveLength(1);
    const turn = h.turnEvents()[0] as { outcome: string; reason?: string };
    expect(turn.outcome).toBe("failure");
    expect(turn.reason).toBe("wake-timeout:agent-pod-failed:ImagePullFailure");
  });

  it("transient failure: posts the still-starting note, retries once, answers", async () => {
    let calls = 0;
    const h = harness(async (_id, opts) => {
      calls++;
      opts?.onWaking?.();
      if (calls === 1) throw wakeError({ kind: "agent-pod-not-ready" });
    });
    await h.mention();

    expect(calls).toBe(2);
    const joined = h.texts().join("\n");
    expect(joined).toContain("still starting");
    expect(h.texts()).toContain("the answer");
    // The retry's onWaking must not re-announce the wake.
    const wakingNotices = h.gw
      .readOutbound()
      .filter((r) => r.kind === "ephemeral" && r.text.includes("Waking"));
    expect(wakingNotices).toHaveLength(1);
    expect((h.turnEvents()[0] as { outcome: string }).outcome).toBe("success");
  });

  it("transient failure twice: gives up with the warming-up copy", async () => {
    let calls = 0;
    const h = harness(async () => {
      calls++;
      throw wakeError({ kind: "agent-pod-not-ready" });
    });
    await h.mention();

    expect(calls).toBe(2);
    const joined = h.texts().join("\n");
    expect(joined).toContain("still warming up");
    expect((h.turnEvents()[0] as { outcome: string }).outcome).toBe("failure");
  });
});
