// TEST_OVERVIEW: A DM the Bridge revoked stops working at the worker, not only in the database: a new message to it is answered with why and never reaches the Agent, a turn already queued for it is dropped when it is about to prompt, a reply in a thread that Agent's Session owned there is dropped the same way, and a post or a thread the Agent tries to start there is refused even while the owner's OAuth link and another connection would reach it. The in-chat unbind runs through the real slash command, releases only a DM the Bridge recorded, and tells the person when the release did not finish.
import { describe, expect, it, vi } from "vitest";
import {
  SLACK_HARNESS_OWNER,
  slackWorkerHarness,
} from "../helpers/slack-worker.js";
import {
  createMemorySlackOwnedThreads,
  type SlackOwnedThreads,
} from "../../modules/channels/infrastructure/slack-owned-threads-repository.js";
import type { SlackDmBridgePort } from "../../modules/channels/infrastructure/slack.js";

const DM = "D0OWNER";
const CHANNEL = "C0OTHER";
const OWNER_USER = "U0OWNER";

interface BridgeFake {
  port: SlackDmBridgePort;
  releases: { agentId: string; teamId: string; slackChannelId: string }[];
  blockCalls: number;
  setRelease: (result: "none" | "revoked" | "incomplete" | "failed") => void;
  setPending: (
    records: {
      agentId: string;
      ownerSub: string;
      state: "active" | "revoking";
    }[],
  ) => void;
}

function bridgePort(blocked: (channelId: string) => boolean): BridgeFake {
  const state = {
    release: "revoked" as "none" | "revoked" | "incomplete" | "failed",
    pending: [] as {
      agentId: string;
      ownerSub: string;
      state: "active" | "revoking";
    }[],
  };
  const releases: {
    agentId: string;
    teamId: string;
    slackChannelId: string;
  }[] = [];
  const fake: BridgeFake = {
    releases,
    blockCalls: 0,
    setRelease: (result) => {
      state.release = result;
    },
    setPending: (records) => {
      state.pending = records;
    },
    port: {
      blocks: async (_agentId, _teamId, channelId) => {
        fake.blockCalls += 1;
        return blocked(channelId);
      },
      releaseInChat: async (args) => {
        releases.push(args);
        return state.release;
      },
      pendingInChat: async () => state.pending,
      reopenChannel: async () => {},
    },
  };
  return fake;
}

async function quiet(ms = 120): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

describe("a revoked DM at the worker", () => {
  // TEST_SCENARIO: A new message to a revoked DM is answered with why and never becomes a turn, even though the binding still exists.
  it("admits no new turn from a revoked DM", async () => {
    let blocked = false;
    const bridge = bridgePort(() => blocked);
    const h = slackWorkerHarness({
      boundChannelId: DM,
      dmBridges: bridge.port,
      linkedSub: SLACK_HARNESS_OWNER,
      linkedSlackUsers: [OWNER_USER],
    });
    await h.worker.connect();

    await h.gw.fireDirectMessage({
      user: OWNER_USER,
      channel: DM,
      ts: "1.1",
      text: "hello",
    });
    await quiet();
    expect(h.prompts).toHaveLength(1);

    blocked = true;
    await h.gw.fireDirectMessage({
      user: OWNER_USER,
      channel: DM,
      ts: "2.2",
      text: "still there?",
    });
    await quiet();
    expect(h.prompts).toHaveLength(1);
    expect(
      h.gw
        .readOutbound()
        .filter((r) => r.kind === "ephemeral")
        .map((r) => r.text),
    ).toEqual([expect.stringContaining("released this conversation")]);
  });

  // TEST_SCENARIO: A message admitted before the revoke still waits in the queue, and the turn is dropped when it is about to prompt.
  it("drops a queued DM turn when the revoke lands before it prompts", async () => {
    let blocked = false;
    const bridge = bridgePort(() => blocked);
    const h = slackWorkerHarness({
      boundChannelId: DM,
      dmBridges: bridge.port,
      linkedSub: SLACK_HARNESS_OWNER,
      linkedSlackUsers: [OWNER_USER],
      settleMs: 40,
    });
    await h.worker.connect();

    const fired = h.gw.fireDirectMessage({
      user: OWNER_USER,
      channel: DM,
      ts: "1.1",
      text: "hello",
    });
    blocked = true;
    await fired;
    expect(h.prompts).toEqual([]);
  });

  // TEST_SCENARIO: A reply in a thread this Agent's Session owned in that DM is dropped at the same point.
  it("drops an owned-thread reply racing the revoke", async () => {
    let blocked = false;
    const bridge = bridgePort(() => blocked);
    const ownedThreads: SlackOwnedThreads = createMemorySlackOwnedThreads();
    await ownedThreads.own({
      channelId: DM,
      threadTs: "111.1",
      teamId: "",
      agentId: "agent-1",
      sessionId: "s-1",
      firstLine: "a thread the agent started",
    });
    const h = slackWorkerHarness({
      boundChannelId: DM,
      dmBridges: bridge.port,
      ownedThreads,
      linkedSub: SLACK_HARNESS_OWNER,
      linkedSlackUsers: [OWNER_USER],
      settleMs: 40,
    });
    await h.worker.connect();

    const fired = h.gw.fireDirectMessage({
      user: OWNER_USER,
      channel: DM,
      threadTs: "111.1",
      ts: "222.2",
      text: "my notes",
    });
    blocked = true;
    await fired;
    expect(h.prompts).toEqual([]);
  });

  // TEST_SCENARIO: A post into the revoked DM is refused although the owner's OAuth link and another connection would reach it, and the unrelated connection still works.
  it("refuses proactive delivery into a revoked DM and keeps unrelated reach", async () => {
    const bridge = bridgePort((channelId) => channelId === DM);
    const h = slackWorkerHarness({
      boundChannelId: DM,
      otherBound: [CHANNEL],
      dmBridges: bridge.port,
      linkedSub: SLACK_HARNESS_OWNER,
      linkedSlackUsers: [OWNER_USER],
    });
    await h.worker.connect();

    expect(
      await h.worker.postMessage("agent-1", "your draft", {
        conversationId: DM,
      }),
    ).toEqual({ error: expect.stringContaining("released this conversation") });
    expect(
      await h.worker.postMessage("agent-1", "still here", {
        conversationId: CHANNEL,
      }),
    ).toMatchObject({ ok: true });
  });
});

describe("every path into and out of a revoked DM", () => {
  // TEST_SCENARIO: the ingress check passes and the dequeue check is what stops the turn, which the call count proves rather than the ingress refusal.
  it("drops the turn at dequeue, not only at ingress", async () => {
    const bridge = bridgePort(() => false);
    const inner = bridge.port.blocks.bind(bridge.port);
    bridge.port.blocks = async (agentId, teamId, channelId) => {
      const answer = await inner(agentId, teamId, channelId);
      // TEST_SCENARIO: the first call is the ingress; everything after it is the dequeue.
      return bridge.blockCalls > 1 ? true : answer;
    };
    const h = slackWorkerHarness({
      boundChannelId: DM,
      dmBridges: bridge.port,
      linkedSub: SLACK_HARNESS_OWNER,
      linkedSlackUsers: [OWNER_USER],
      settleMs: 30,
    });
    await h.worker.connect();

    await h.gw.fireDirectMessage({
      user: OWNER_USER,
      channel: DM,
      ts: "1.1",
      text: "hello",
    });
    await quiet(150);
    expect(bridge.blockCalls).toBeGreaterThan(1);
    expect(h.prompts).toEqual([]);
    expect(h.gw.readOutbound().filter((r) => r.kind === "ephemeral")).toEqual(
      [],
    );
  });

  // TEST_SCENARIO: one Session's owned queue mixes its threads, so a revoked DM's message is dropped without dropping an unrelated thread's message.
  it("drops only the revoked destination in a mixed owned batch", async () => {
    const bridge = bridgePort((channelId) => channelId === DM);
    const ownedThreads: SlackOwnedThreads = createMemorySlackOwnedThreads();
    for (const [channelId, threadTs] of [
      [DM, "111.1"],
      [CHANNEL, "222.1"],
    ] as const)
      await ownedThreads.own({
        channelId,
        threadTs,
        teamId: "",
        agentId: "agent-1",
        sessionId: "s-1",
        firstLine: "a thread",
      });
    const h = slackWorkerHarness({
      boundChannelId: DM,
      otherBound: [CHANNEL],
      dmBridges: bridge.port,
      ownedThreads,
      linkedSub: SLACK_HARNESS_OWNER,
      linkedSlackUsers: [OWNER_USER],
      settleMs: 20,
    });
    await h.worker.connect();

    const [dead, live] = await Promise.all([
      h.gw.fireDirectMessage({
        user: OWNER_USER,
        channel: DM,
        threadTs: "111.1",
        ts: "333.3",
        text: "in the released dm",
      }),
      h.gw.fireDirectMessage({
        user: OWNER_USER,
        channel: CHANNEL,
        threadTs: "222.1",
        ts: "444.4",
        text: "in the live channel",
      }),
    ]);
    void dead;
    void live;
    await quiet(150);
    expect(h.prompts).toHaveLength(1);
    expect(String(h.prompts[0])).toContain("in the live channel");
    expect(String(h.prompts[0])).not.toContain("released dm");
  });

  // TEST_SCENARIO: a reply and a thread the Agent starts are sends too, and both are refused into a revoked DM while the unrelated conversation still takes them.
  it("refuses reply and start_thread into a revoked DM", async () => {
    const bridge = bridgePort((channelId) => channelId === DM);
    const h = slackWorkerHarness({
      boundChannelId: DM,
      otherBound: [CHANNEL],
      dmBridges: bridge.port,
      linkedSub: SLACK_HARNESS_OWNER,
      linkedSlackUsers: [OWNER_USER],
    });
    await h.worker.connect();

    expect(
      await h.worker.reply?.("agent-1", {
        text: "an answer",
        conversationId: DM,
        threadTs: "1.1",
      }),
    ).toMatchObject({ error: expect.stringContaining("released") });
    expect(
      await h.worker.startThread?.("agent-1", {
        text: "starting",
        conversationId: DM,
        sessionId: "s-1",
      }),
    ).toMatchObject({ error: expect.stringContaining("released") });
    expect(
      await h.worker.postMessage("agent-1", "still fine", {
        conversationId: CHANNEL,
      }),
    ).toMatchObject({ ok: true });
  });

  // TEST_SCENARIO: opening a whisper thread posts its root into the DM, so a revoked DM refuses that before it is written.
  it("refuses to open a whisper thread in a revoked DM", async () => {
    const bridge = bridgePort((channelId) => channelId === `D-${OWNER_USER}`);
    const h = slackWorkerHarness({
      boundChannelId: CHANNEL,
      dmBridges: bridge.port,
      linkedSub: SLACK_HARNESS_OWNER,
      linkedSlackUsers: [OWNER_USER],
    });
    await h.worker.connect();
    const ack = await h.gw.fireCommand({
      text: "whisper",
      channelId: CHANNEL,
      userId: OWNER_USER,
    });
    expect(ack).toContain("released");
    expect(h.prompts).toEqual([]);
  });
});

describe("the in-chat unbind", () => {
  // TEST_SCENARIO: The slash command releases the Bridge record of the DM it ran in and tells the person when that release did not finish.
  it("runs the release and reports an unfinished one", async () => {
    const bridge = bridgePort(() => false);
    const unbind = vi.fn(async () => {});
    const h = slackWorkerHarness({
      boundChannelId: DM,
      dmBridges: bridge.port,
      linkedSub: SLACK_HARNESS_OWNER,
      linkedSlackUsers: [OWNER_USER],
      unbindSlackChannel: unbind,
    });
    await h.worker.connect();

    bridge.setPending([
      { agentId: "agent-1", ownerSub: SLACK_HARNESS_OWNER, state: "active" },
    ]);
    bridge.setRelease("incomplete");
    const incomplete = await h.gw.fireCommand({
      text: "unbind",
      channelId: DM,
      userId: OWNER_USER,
    });
    expect(bridge.releases).toEqual([
      { agentId: "agent-1", teamId: "", slackChannelId: DM },
    ]);
    // TEST_SCENARIO: the Bridge's own record released the binding; the unscoped delete never ran.
    expect(unbind).not.toHaveBeenCalled();
    expect(incomplete).toContain("closed to turns and deliveries");
    expect(incomplete).toContain("did not finish");

    bridge.setRelease("revoked");
    const clean = await h.gw.fireCommand({
      text: "unbind",
      channelId: DM,
      userId: OWNER_USER,
    });
    expect(clean).toContain("disconnected");
    expect(clean).not.toContain("did not finish");
    expect(clean).toContain("pair it again from the platform");
  });

  // TEST_SCENARIO: A record that cannot be closed says so instead of claiming the DM is closed, and the retry — with the binding already gone — still reaches it.
  it("does not claim closure when the record could not be closed", async () => {
    const bridge = bridgePort(() => false);
    const unbind = vi.fn(async () => {});
    const h = slackWorkerHarness({
      boundChannelId: DM,
      dmBridges: bridge.port,
      linkedSub: SLACK_HARNESS_OWNER,
      linkedSlackUsers: [OWNER_USER],
      unbindSlackChannel: unbind,
    });
    await h.worker.connect();
    bridge.setPending([
      { agentId: "agent-1", ownerSub: SLACK_HARNESS_OWNER, state: "active" },
    ]);
    bridge.setRelease("failed");
    const failed = await h.gw.fireCommand({
      text: "unbind",
      channelId: DM,
      userId: OWNER_USER,
    });
    expect(failed).toContain("nothing was changed");
    expect(failed).not.toContain("closed to turns");

    bridge.setRelease("revoked");
    const retried = await h.gw.fireCommand({
      text: "unbind",
      channelId: DM,
      userId: OWNER_USER,
    });
    expect(retried).toContain("disconnected");
    expect(bridge.releases).toHaveLength(2);
    expect(unbind).not.toHaveBeenCalled();
  });

  // TEST_SCENARIO: The same command in a channel asks the Bridge for nothing, because only a DM can carry a record.
  it("does not release a channel through the bridge port", async () => {
    const bridge = bridgePort(() => false);
    const h = slackWorkerHarness({
      boundChannelId: CHANNEL,
      dmBridges: bridge.port,
      linkedSub: SLACK_HARNESS_OWNER,
      linkedSlackUsers: [OWNER_USER],
    });
    await h.worker.connect();
    bridge.setRelease("none");
    const ack = await h.gw.fireCommand({
      text: "unbind",
      channelId: CHANNEL,
      userId: OWNER_USER,
    });
    expect(bridge.releases).toEqual([]);
    expect(ack).toContain("disconnected");
  });
});
