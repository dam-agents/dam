import { describe, it, expect, vi } from "vitest";
import { ChannelType } from "api-server-api";
import { createBusRpc } from "../../core/bus-rpc.js";
import type { RedisBus, BusListener } from "../../core/redis-bus.js";
import {
  createChannelManager,
  type ChannelRpcRequest,
} from "../../modules/channels/services/channel-manager.js";
import type { SlackWorker } from "../../modules/channels/infrastructure/slack.js";

/** In-process stand-in for Redis pub/sub, shared by both "replicas". */
function fakeBus(): RedisBus {
  const listeners = new Map<string, Set<BusListener>>();
  return {
    async publish(channel, payload) {
      // Async delivery, like the real bus — catches anything that assumes a
      // synchronous round trip.
      await Promise.resolve();
      for (const fn of listeners.get(channel) ?? []) fn(payload);
    },
    subscribe(channel, listener) {
      let set = listeners.get(channel);
      if (!set) listeners.set(channel, (set = new Set()));
      set.add(listener);
      return () => set!.delete(listener);
    },
    async close() {},
  };
}

function fakeSlackWorker(): SlackWorker {
  return {
    type: ChannelType.Slack,
    connect: vi.fn(async () => {}),
    start: vi.fn(async () => {}),
    stop: vi.fn(async () => {}),
    stopAll: vi.fn(async () => {}),
    listConversations: vi.fn(async () => []),
    postMessage: vi.fn(async () => ({ ok: true as const })),
    reply: vi.fn(async () => ({ ok: true as const })),
    react: vi.fn(async () => ({ ok: true as const })),
    describeUsers: vi.fn(async () => ({ users: [] })),
    supportsUserLookup: vi.fn(async () => true),
    describeMessageReactions: vi.fn(async () => ({
      reactions: [],
      conversationId: "C1",
      messageTs: "1.1",
    })),
    supportsMessageReactions: vi.fn(async () => true),
  };
}

describe("channel outbound across replicas", () => {
  it("routes a follower's reply to the leader's worker", async () => {
    const bus = fakeBus();
    const leaderWorker = fakeSlackWorker();
    const followerWorker = fakeSlackWorker();

    const leader = createChannelManager({
      slackWorker: leaderWorker,
      rpc: createBusRpc<ChannelRpcRequest, unknown>({
        bus,
        service: "channels",
      }),
      isLeader: () => true,
    });
    const follower = createChannelManager({
      slackWorker: followerWorker,
      rpc: createBusRpc<ChannelRpcRequest, unknown>({
        bus,
        service: "channels",
      }),
      isLeader: () => false,
    });

    await leader.bootstrap(new Map());

    // The agent's reply arrives over MCP on whichever replica the harness
    // Service pinned its gateway to — which is not the replica holding the
    // Slack socket, and so not the one holding this turn's thread refs.
    const result = await follower.reply("agent-1", ChannelType.Slack, {
      text: "hi",
    });

    expect(result).toEqual({ ok: true });
    expect(leaderWorker.reply).toHaveBeenCalledWith("agent-1", { text: "hi" });
    // The follower's own worker is inert — it holds no turn state.
    expect(followerWorker.reply).not.toHaveBeenCalled();

    await leader.stopAll();
    await follower.stopAll();
  });

  it("surfaces the leader's error to the caller instead of silently retrying", async () => {
    const bus = fakeBus();
    const leaderWorker = fakeSlackWorker();
    leaderWorker.react = vi.fn(async () => ({ error: "message not found" }));

    const leader = createChannelManager({
      slackWorker: leaderWorker,
      rpc: createBusRpc<ChannelRpcRequest, unknown>({
        bus,
        service: "channels",
      }),
      isLeader: () => true,
    });
    const follower = createChannelManager({
      slackWorker: fakeSlackWorker(),
      rpc: createBusRpc<ChannelRpcRequest, unknown>({
        bus,
        service: "channels",
      }),
      isLeader: () => false,
    });
    await leader.bootstrap(new Map());

    expect(
      await follower.react("agent-1", ChannelType.Slack, { emoji: "eyes" }),
    ).toEqual({ error: "message not found" });

    await leader.stopAll();
    await follower.stopAll();
  });

  it("times out rather than hanging when no replica serves", async () => {
    const bus = fakeBus();
    const follower = createChannelManager({
      slackWorker: fakeSlackWorker(),
      rpc: createBusRpc<ChannelRpcRequest, unknown>({
        bus,
        service: "channels",
        timeoutMs: 20,
      }),
      isLeader: () => false,
    });

    // No leader bootstrapped, so nothing answers. A hung promise would wedge
    // the agent's tool call forever; a rejection would break every caller's
    // `"error" in result` branch. It has to surface as an error result.
    expect(
      await follower.postMessage("agent-1", ChannelType.Slack, "hi"),
    ).toEqual({ error: expect.stringMatching(/timed out/) });

    await follower.stopAll();
  });

  it("stops serving once the lease is lost", async () => {
    const bus = fakeBus();
    const leaderWorker = fakeSlackWorker();
    const rpc = createBusRpc<ChannelRpcRequest, unknown>({
      bus,
      service: "channels",
      timeoutMs: 20,
    });
    const leader = createChannelManager({
      slackWorker: leaderWorker,
      rpc,
      isLeader: () => true,
    });
    const follower = createChannelManager({
      slackWorker: fakeSlackWorker(),
      rpc: createBusRpc<ChannelRpcRequest, unknown>({
        bus,
        service: "channels",
        timeoutMs: 20,
      }),
      isLeader: () => false,
    });

    await leader.bootstrap(new Map());
    await leader.standDown();

    // standDown must unhook the rpc server, or a demoted replica keeps
    // answering with workers it has already stopped.
    expect(
      await follower.reply("agent-1", ChannelType.Slack, { text: "hi" }),
    ).toEqual({ error: expect.stringMatching(/timed out/) });
    expect(leaderWorker.reply).not.toHaveBeenCalled();

    await leader.stopAll();
    await follower.stopAll();
  });
});
