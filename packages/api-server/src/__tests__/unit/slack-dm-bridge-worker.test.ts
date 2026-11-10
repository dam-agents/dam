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

function bridgePort(blocked: (channelId: string) => boolean): {
  port: SlackDmBridgePort;
  releases: { agentId: string; teamId: string; slackChannelId: string }[];
  setRelease: (result: "none" | "revoked" | "incomplete") => void;
} {
  const state = { release: "revoked" as "none" | "revoked" | "incomplete" };
  const releases: {
    agentId: string;
    teamId: string;
    slackChannelId: string;
  }[] = [];
  return {
    releases,
    setRelease: (result) => {
      state.release = result;
    },
    port: {
      blocks: async (_agentId, _teamId, channelId) => blocked(channelId),
      releaseInChat: async (args) => {
        releases.push(args);
        return state.release;
      },
    },
  };
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

    bridge.setRelease("incomplete");
    const incomplete = await h.gw.fireCommand({
      text: "unbind",
      channelId: DM,
      userId: OWNER_USER,
    });
    expect(unbind).toHaveBeenCalledWith("agent-1", DM);
    expect(bridge.releases).toEqual([
      { agentId: "agent-1", teamId: "", slackChannelId: DM },
    ]);
    expect(incomplete).toContain("disconnected");
    expect(incomplete).toContain("did not finish");

    bridge.setRelease("revoked");
    const clean = await h.gw.fireCommand({
      text: "unbind",
      channelId: DM,
      userId: OWNER_USER,
    });
    expect(clean).toContain("disconnected");
    expect(clean).not.toContain("did not finish");
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
    expect(bridge.releases).toEqual([
      { agentId: "agent-1", teamId: "", slackChannelId: CHANNEL },
    ]);
    expect(ack).not.toContain("did not finish");
  });
});
