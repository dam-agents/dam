import { describe, it, expect } from "vitest";
import { configureLogger } from "../../core/logger.js";
import { slackWorkerHarness } from "../helpers/slack-worker.js";
import type { AcpClient } from "../../core/acp-client.js";
import {
  agentContextBlock,
  footerSessionId,
  parseAgentFooter,
} from "../../modules/channels/infrastructure/agent-footer.js";
import type { SlackMessage } from "../../modules/channels/infrastructure/slack-gateway.js";
import { agentPostMetadata } from "../../modules/channels/infrastructure/slack-post-delete.js";

configureLogger({ level: "error", write: () => {} });

/**
 * TEST_OVERVIEW: An Agent changes a post it made earlier in Slack. The post
 * is changed in place and keeps the footer that names its Agent and the
 * Session that made it. Only the Agent that made a post with its own tools
 * can change it: a post by another Agent, a notice the platform posted in the
 * Agent's name, a message nobody's Agent wrote and a message that does not
 * exist are refused. A post that carries a file keeps it, or gets a new one
 * in its place. A link an Agent puts in its own post does not change who wrote it. Edits are limited per
 * minute, before anything is asked of Slack. An edit to a post in the thread
 * a turn answers counts as answering that turn.
 */

const BOUND = "C1";
const USER = "U1";
const UI = "http://ui";

const T1 = "100.000000";
const OWN = "150.000000";

const NUDGE = "<turn-undelivered>";

function harness(opts: Parameters<typeof slackWorkerHarness>[0] = {}) {
  return slackWorkerHarness({
    boundChannelId: BOUND,
    channels: [{ id: BOUND, name: "general", botIsMember: true }],
    ...opts,
  });
}

function footerOf(agentId: string, sessionId?: string) {
  return agentContextBlock({
    uiBaseUrl: UI,
    agentId,
    label: "Sent by",
    ...(sessionId ? { sessionId } : {}),
  });
}

function agentPost(
  ts: string,
  agentId: string,
  over: Partial<SlackMessage> = {},
): SlackMessage & { ts: string } {
  return {
    ts,
    user: "U-BOT",
    text: "step 1 of 3",
    blocks: [
      { type: "markdown", text: "step 1 of 3" } as never,
      footerOf(agentId),
    ],
    metadata: agentPostMetadata([], true),
    ...over,
  };
}

const edit = (ts: string, text = "step 2 of 3") => ({
  conversationId: BOUND,
  messageId: ts,
  text,
});

describe("an agent changes its own Slack post", () => {
  /**
   * TEST_SCENARIO: The agent keeps one post current. The change lands on the
   * same message, with the new text, and the post still names its agent.
   */
  it("changes the post in place and keeps its footer", async () => {
    const h = harness();
    await h.worker.connect();
    const posted = await h.worker.postMessage("agent-1", "step 1 of 3", {
      byAgent: true,
    });
    if (!("ok" in posted) || !posted.ts) throw new Error("no post");

    const result = await h.worker.editPost("agent-1", edit(posted.ts));

    expect(result).toEqual({ ok: true, conversationId: BOUND, ts: posted.ts });
    expect(h.gw.readUpdates()).toMatchObject([
      {
        channel: BOUND,
        ts: posted.ts,
        text: expect.stringContaining("step 2 of 3"),
      },
    ]);
    const shown = await h.gw.getMessage({
      channel: BOUND,
      ts: posted.ts,
      teamId: "",
    });
    expect(shown?.text).toContain("step 2 of 3");
    expect(shown?.text).not.toContain("step 1 of 3");
    expect(parseAgentFooter(shown!)).toMatchObject({ agentId: "agent-1" });
  });

  /**
   * TEST_SCENARIO: A turn's reply links the Session that made it, which is
   * where its owner opens the conversation and where a deleted post's notice
   * goes. An edit from any later Session must leave that link as it was.
   */
  it("keeps the session the post was made on", async () => {
    const h = harness();
    await h.worker.connect();
    h.gw.setMessage(
      BOUND,
      agentPost(OWN, "agent-1", {
        blocks: [
          { type: "markdown", text: "step 1 of 3" } as never,
          footerOf("agent-1", "sess-9"),
        ],
      }),
    );

    await h.worker.editPost("agent-1", edit(OWN));

    const shown = await h.gw.getMessage({
      channel: BOUND,
      ts: OWN,
      teamId: "",
    });
    expect(footerSessionId(shown!)).toBe("sess-9");
  });

  /**
   * TEST_SCENARIO: Every agent posts through the one bot, so Slack would let
   * any of them change any of the bot's posts. The footer names the author,
   * and a post another agent wrote stays as it was.
   */
  it("refuses a post another agent wrote", async () => {
    const h = harness();
    await h.worker.connect();
    h.gw.setMessage(BOUND, agentPost(OWN, "agent-2"));

    const result = await h.worker.editPost("agent-1", edit(OWN));

    expect(result).toMatchObject({
      error: expect.stringContaining("Another agent wrote that post"),
    });
    expect(h.gw.readUpdates()).toEqual([]);
  });

  /**
   * TEST_SCENARIO: An agent's card can show a line of small text with any
   * link in it, also a link to another agent's page, and Slack shows that
   * line as the same kind of block as the footer. Who wrote the post is read
   * from the block that ends it, so such a line neither hands the post to
   * the other agent nor takes it from its author.
   */
  it("reads the author from the footer, not from a link inside the post", async () => {
    const h = harness();
    await h.worker.connect();
    h.gw.setMessage(
      BOUND,
      agentPost(OWN, "agent-1", {
        blocks: [
          { type: "markdown", text: "step 1 of 3" } as never,
          footerOf("agent-2", "sess-forged"),
          footerOf("agent-1", "sess-9"),
        ],
      }),
    );

    expect(await h.worker.editPost("agent-2", edit(OWN))).toMatchObject({
      error: expect.stringContaining("Another agent wrote that post"),
    });
    expect(await h.worker.editPost("agent-1", edit(OWN))).toMatchObject({
      ok: true,
    });
    const shown = await h.gw.getMessage({
      channel: BOUND,
      ts: OWN,
      teamId: "",
    });
    expect(footerSessionId({ blocks: shown!.blocks!.slice(-1) })).toBe(
      "sess-9",
    );
  });

  /**
   * TEST_SCENARIO: The platform also posts in an agent's name, with its
   * footer: a greeting when it is connected, a notice. The agent did not
   * write those, so it cannot rewrite them.
   */
  it("refuses a post the platform made in the agent's name", async () => {
    const h = harness();
    await h.worker.connect();
    const notice = await h.worker.postMessage("agent-1", "Helper joined.");
    if (!("ok" in notice) || !notice.ts) throw new Error("no post");

    const result = await h.worker.editPost("agent-1", edit(notice.ts));

    expect(result).toMatchObject({
      error: expect.stringContaining("not one of your posts"),
    });
    expect(h.gw.readUpdates()).toEqual([]);
  });

  it("refuses a message no agent wrote", async () => {
    const h = harness();
    await h.worker.connect();
    h.gw.setMessage(BOUND, { ts: OWN, user: USER, text: "a person's note" });

    const result = await h.worker.editPost("agent-1", edit(OWN));

    expect(result).toMatchObject({
      error: expect.stringContaining("not one of your posts"),
    });
    expect(h.gw.readUpdates()).toEqual([]);
  });

  /**
   * TEST_SCENARIO: A ts that names no message makes Slack refuse the read
   * with its own error code. The agent must get the guidance on which
   * reference to pass, not Slack's raw error.
   */
  it("refuses a message that does not exist, also when Slack refuses the read", async () => {
    const h = harness();
    await h.worker.connect();

    expect(
      await h.worker.editPost("agent-1", edit("999.000000")),
    ).toMatchObject({
      error: expect.stringContaining("No post with that ts"),
    });

    h.gw.getMessage = async () => {
      throw new Error("An API error occurred: thread_not_found");
    };
    expect(
      await h.worker.editPost("agent-1", edit("999.000000")),
    ).toMatchObject({
      error: expect.stringContaining("No post with that ts"),
    });
  });

  /**
   * TEST_SCENARIO: An agent posts a chart and later a newer one. Slack shares
   * the file without naming its message, so the post's ts is read back from
   * the file and the post gets the agent's mark by an edit. The agent then
   * swaps the chart in place, and the old file leaves the workspace.
   */
  it("replaces the file of a post it made with a file", async () => {
    const h = harness();
    await h.worker.connect();
    const posted = await h.worker.postMessage("agent-1", "chart v1", {
      byAgent: true,
      attachment: { filename: "chart-v1.png", data: Buffer.from("v1") },
    });
    if (!("ok" in posted) || !posted.ts) throw new Error("no ts");
    const before = await h.gw.getMessage({
      channel: BOUND,
      ts: posted.ts,
      teamId: "",
    });
    const deleted: string[] = [];
    h.gw.deleteFile = async (fileId) => {
      deleted.push(fileId);
    };

    const result = await h.worker.editPost("agent-1", {
      ...edit(posted.ts, "chart v2"),
      attachment: { filename: "chart-v2.png", data: Buffer.from("v2") },
    });

    expect(result).toEqual({ ok: true, conversationId: BOUND, ts: posted.ts });
    const update = h.gw.readUpdates().at(-1);
    expect(update?.text).toContain("chart v2");
    expect(update?.fileIds).toEqual([expect.stringContaining("chart-v2")]);
    expect(deleted).toEqual(before?.fileIds);
  });

  /**
   * TEST_SCENARIO: A post sent with previews off carries its file as a
   * separate message, named in the post's metadata. Replacing the file
   * retires that one too, so the old chart does not stay beside the new.
   */
  it("retires a file posted apart when the edit replaces it", async () => {
    const h = harness();
    await h.worker.connect();
    h.gw.setMessage(
      BOUND,
      agentPost(OWN, "agent-1", {
        metadata: agentPostMetadata(["F-APART"], true),
      }),
    );
    const deleted: string[] = [];
    h.gw.deleteFile = async (fileId) => {
      deleted.push(fileId);
    };

    const result = await h.worker.editPost("agent-1", {
      ...edit(OWN, "chart v2"),
      attachment: { filename: "chart-v2.png", data: Buffer.from("v2") },
    });

    expect(result).toMatchObject({ ok: true });
    expect(deleted).toEqual(["F-APART"]);
    expect(h.gw.readUpdates()[0]?.metadata.payload["files"]).toEqual([]);
  });

  /**
   * TEST_SCENARIO: Slack can apply an edit and lose its answer. The new file
   * may then already show on the post, so it is not deleted, and neither is
   * the old one.
   */
  it("keeps every file when Slack's answer to the edit is lost", async () => {
    const h = harness();
    await h.worker.connect();
    h.gw.setMessage(BOUND, agentPost(OWN, "agent-1", { fileIds: ["F1"] }));
    h.gw.updateMessage = async () => {
      throw new Error("socket hang up");
    };
    const deleted: string[] = [];
    h.gw.deleteFile = async (fileId) => {
      deleted.push(fileId);
    };

    const result = await h.worker.editPost("agent-1", {
      ...edit(OWN, "chart v2"),
      attachment: { filename: "chart-v2.png", data: Buffer.from("v2") },
    });

    expect(result).toMatchObject({ error: expect.stringContaining("hang up") });
    expect(deleted).toEqual([]);
  });

  /**
   * TEST_SCENARIO: Removing the caption of a post with a file leaves the file
   * as it is: the edit names no files, so Slack keeps them.
   */
  it("keeps the file of a post when only its text changes", async () => {
    const h = harness();
    await h.worker.connect();
    h.gw.setMessage(BOUND, agentPost(OWN, "agent-1", { fileIds: ["F1"] }));

    const result = await h.worker.editPost("agent-1", edit(OWN, ""));

    expect(result).toMatchObject({ ok: true });
    expect(h.gw.readUpdates()).toEqual([
      expect.not.objectContaining({ fileIds: expect.anything() }),
    ]);
  });

  it("refuses an edit that would show nothing", async () => {
    const h = harness();
    await h.worker.connect();
    h.gw.setMessage(BOUND, agentPost(OWN, "agent-1"));

    expect(await h.worker.editPost("agent-1", edit(OWN, "  "))).toMatchObject({
      error: expect.stringContaining("needs text or a card"),
    });
  });

  /**
   * TEST_SCENARIO: A progress post updated in a loop would use up the
   * workspace's share of edits. An agent's edits past its own limit are
   * refused with the time to wait, and nothing more reaches Slack.
   */
  it("refuses edits that come too fast, and says how long to wait", async () => {
    const h = harness();
    await h.worker.connect();
    h.gw.setMessage(BOUND, agentPost(OWN, "agent-1"));

    for (let step = 1; step <= 10; step++)
      expect(
        await h.worker.editPost("agent-1", edit(OWN, `step ${step}`)),
      ).toMatchObject({ ok: true });
    const read = h.gw.getMessage.bind(h.gw);
    let reads = 0;
    h.gw.getMessage = async (args) => {
      reads += 1;
      return read(args);
    };
    const result = await h.worker.editPost("agent-1", edit(OWN, "step 11"));

    expect(reads).toBe(0);
    expect(result).toMatchObject({
      error: expect.stringMatching(
        /Too many edits right now\. Wait \d+ seconds/,
      ),
    });
    expect(h.gw.readUpdates()).toHaveLength(10);
  });
});

describe("an edit as the answer to a turn", () => {
  function turnThatEdits(edits: boolean) {
    const worker: { editPost?: () => Promise<unknown> } = {};
    const h = harness({
      reportSession: true,
      makeAcp: (base: AcpClient): AcpClient => ({
        ...base,
        sendPrompt: async (prompt, sendOpts) => {
          if (edits && !String(prompt).includes(NUDGE))
            await worker.editPost?.();
          return base.sendPrompt(prompt, sendOpts);
        },
      }),
    });
    worker.editPost = () => h.worker.editPost("agent-1", edit(OWN));
    h.gw.setMessage(BOUND, agentPost(OWN, "agent-1", { threadTs: T1 }));
    const nudged = () => h.prompts.some((p) => String(p).includes(NUDGE));
    return { ...h, nudged };
  }

  /**
   * TEST_SCENARIO: A person asks the agent to fix its earlier reply, and the
   * agent fixes it in place and writes nothing more. The edit is the answer:
   * the turn must not be repaired as one that delivered nothing. A turn that
   * does nothing at all still is.
   */
  it("counts an edit in the turn's thread as answering it", async () => {
    const silent = turnThatEdits(false);
    await silent.worker.connect();
    await silent.gw.fireMention({
      user: USER,
      channel: BOUND,
      ts: "120.000000",
      threadTs: T1,
      text: "fix your reply",
    });
    expect(await silent.settled(silent.nudged)).toBe(true);

    const fixing = turnThatEdits(true);
    await fixing.worker.connect();
    await fixing.gw.fireMention({
      user: USER,
      channel: BOUND,
      ts: "120.000000",
      threadTs: T1,
      text: "fix your reply",
    });
    await fixing.settled(fixing.nudged);

    expect(fixing.gw.readUpdates()).toHaveLength(1);
    expect(fixing.nudged()).toBe(false);
  });
});
