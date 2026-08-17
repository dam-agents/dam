import { describe, it, expect, vi } from "vitest";
import { ChannelType } from "api-server-api";
import { createBusRpc } from "../../core/bus-rpc.js";
import type { RedisBus, BusListener } from "../../core/redis-bus.js";
import {
  createChannelManager,
  type ChannelRpcRequest,
} from "../../modules/channels/services/channel-manager.js";
import type { SlackWorker } from "../../modules/channels/infrastructure/slack.js";

function fakeBus(): RedisBus {
  const listeners = new Map<string, Set<BusListener>>();
  return {
    async publish(channel, payload) {
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
    stopAll: vi.fn(async () => {}),
    listConversations: vi.fn(async () => []),
    postMessage: vi.fn(async () => ({ ok: true as const })),
    reply: vi.fn(async () => ({ ok: true as const })),
    react: vi.fn(async () => ({ ok: true as const })),
    declineTurn: vi.fn(async () => ({ ok: true as const })),
    handOffTurn: vi.fn(async () => ({ ok: true as const, agent: "other" })),
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

function fakeBlobs() {
  const store = new Map<string, Buffer>();
  return {
    store,
    handoff: {
      put: async (data: Buffer) => {
        const key = `blob:${store.size}`;
        store.set(key, data);
        return key;
      },
      take: async (key: string) => {
        const v = store.get(key) ?? null;
        store.delete(key);
        return v;
      },
    },
  };
}

describe("channel attachments across replicas", () => {
  it("delivers the bytes intact to the leader's worker", async () => {
    const bus = fakeBus();
    const blobs = fakeBlobs();
    const leaderWorker = fakeSlackWorker();

    const leader = createChannelManager({
      slackWorker: leaderWorker,
      rpc: createBusRpc<ChannelRpcRequest, unknown>({
        bus,
        service: "channels",
      }),
      blobs: blobs.handoff,
      isLeader: () => true,
    });
    const follower = createChannelManager({
      slackWorker: fakeSlackWorker(),
      rpc: createBusRpc<ChannelRpcRequest, unknown>({
        bus,
        service: "channels",
      }),
      blobs: blobs.handoff,
      isLeader: () => false,
    });
    await leader.bootstrap();

    const data = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff, 0xfe]);
    const result = await follower.postMessage(
      "agent-1",
      ChannelType.Slack,
      "here",
      { attachment: { filename: "x.png", data } },
    );

    expect(result).toEqual({ ok: true });
    const passed = vi.mocked(leaderWorker.postMessage).mock.calls[0]![2]!
      .attachment!;
    expect(Buffer.isBuffer(passed.data)).toBe(true);
    expect([...passed.data]).toEqual([...data]);
    expect(passed.filename).toBe("x.png");
    expect(blobs.store.size).toBe(0);
  });

  it("refuses rather than posting a message with the attachment silently missing", async () => {
    const bus = fakeBus();
    const blobs = fakeBlobs();
    const leaderWorker = fakeSlackWorker();

    const leader = createChannelManager({
      slackWorker: leaderWorker,
      rpc: createBusRpc<ChannelRpcRequest, unknown>({
        bus,
        service: "channels",
      }),
      blobs: blobs.handoff,
      isLeader: () => true,
    });
    const follower = createChannelManager({
      slackWorker: fakeSlackWorker(),
      rpc: createBusRpc<ChannelRpcRequest, unknown>({
        bus,
        service: "channels",
      }),
      blobs: blobs.handoff,
      isLeader: () => false,
    });
    await leader.bootstrap();

    const original = blobs.handoff.take;
    blobs.handoff.take = async () => null;

    expect(
      await follower.postMessage("agent-1", ChannelType.Slack, "here", {
        attachment: { filename: "x.png", data: Buffer.from([1, 2, 3]) },
      }),
    ).toEqual({ error: expect.stringMatching(/attachment/i) });
    expect(leaderWorker.postMessage).not.toHaveBeenCalled();

    blobs.handoff.take = original;
    await leader.stopAll();
    await follower.stopAll();
  });
});

describe("channel outbound across replicas", () => {
  it("runs a request once when two replicas both serve", async () => {
    const bus = fakeBus();
    const workerA = fakeSlackWorker();
    const workerB = fakeSlackWorker();
    const claimed = new Set<string>();
    const claim = async (id: string) =>
      claimed.has(id) ? false : (claimed.add(id), true);

    const outgoing = createChannelManager({
      slackWorker: workerA,
      rpc: createBusRpc<ChannelRpcRequest, unknown>({
        bus,
        service: "channels",
        claim,
      }),
      isLeader: () => true,
    });
    const incoming = createChannelManager({
      slackWorker: workerB,
      rpc: createBusRpc<ChannelRpcRequest, unknown>({
        bus,
        service: "channels",
        claim,
      }),
      isLeader: () => true,
    });
    await outgoing.bootstrap();
    await incoming.bootstrap();

    const follower = createChannelManager({
      slackWorker: fakeSlackWorker(),
      rpc: createBusRpc<ChannelRpcRequest, unknown>({
        bus,
        service: "channels",
        claim,
      }),
      isLeader: () => false,
    });

    await follower.postMessage("agent-1", ChannelType.Slack, "hello");

    const posts =
      vi.mocked(workerA.postMessage).mock.calls.length +
      vi.mocked(workerB.postMessage).mock.calls.length;
    expect(posts).toBe(1);

    await outgoing.stopAll();
    await incoming.stopAll();
    await follower.stopAll();
  });

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

    await leader.bootstrap();

    const result = await follower.reply("agent-1", ChannelType.Slack, {
      text: "hi",
    });

    expect(result).toEqual({ ok: true });
    expect(leaderWorker.reply).toHaveBeenCalledWith("agent-1", { text: "hi" });
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
    await leader.bootstrap();

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

    await leader.bootstrap();
    await leader.standDown();

    expect(
      await follower.reply("agent-1", ChannelType.Slack, { text: "hi" }),
    ).toEqual({ error: expect.stringMatching(/timed out/) });
    expect(leaderWorker.reply).not.toHaveBeenCalled();

    await leader.stopAll();
    await follower.stopAll();
  });
});
