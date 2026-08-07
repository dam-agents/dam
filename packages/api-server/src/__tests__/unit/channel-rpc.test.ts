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

/** In-memory stand-in for the Redis blob handoff. */
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
    await leader.bootstrap(new Map());

    // Non-UTF8 bytes: a Buffer put through JSON.stringify comes back as
    // `{type:"Buffer",data:[…]}`, which the worker would upload as garbage.
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
    // Handed off, not leaked.
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
    await leader.bootstrap(new Map());

    // The handoff expired before the leader read it.
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
    // One claim keyspace, as Redis would be.
    const claimed = new Set<string>();
    const claim = async (id: string) =>
      claimed.has(id) ? false : (claimed.add(id), true);

    // Mid-handover: the outgoing holder hasn't noticed it lost the lease and
    // the incoming one has already started serving. PUBLISH reaches both.
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
    await outgoing.bootstrap(new Map());
    await incoming.bootstrap(new Map());

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

    // Exactly one post reaches Slack — not one per serving replica.
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
