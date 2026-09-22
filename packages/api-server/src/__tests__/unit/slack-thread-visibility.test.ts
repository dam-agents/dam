import { describe, it, expect } from "vitest";
import {
  agentContextBlock,
  formatSlackTs,
} from "../../modules/channels/infrastructure/agent-footer.js";
import { configureLogger } from "../../core/logger.js";
import { slackWorkerHarness } from "../helpers/slack-worker.js";

configureLogger({ level: "error", write: () => {} });

const BOUND = "C1";

const ASK_TS = "1758100320.000000";
const AGENT_REPLY_TS = "1758100500.000000";
const HUMAN_REPLY_TS = "1758104000.000000";
const LUNCH_TS = "1758108900.000000";
const MENTION_TS = "1758108960.000000";

const ASK = "can someone look at the staging deploy";
const AGENT_REPLY = "on it — rolling back the migration";
const HUMAN_REPLY = "thanks, confirmed fixed";
const LUNCH = "anyone up for lunch";

/**
 * TEST_OVERVIEW: What a Slack agent can see of a thread it is not inside.
 * Slack's channel read withholds every reply made in one, so the agent must be
 * told which lines are hiding replies and be able to go and read them.
 */
const harness = (opts: { ambient?: boolean } = {}) =>
  slackWorkerHarness({
    boundChannelId: BOUND,
    channels: [{ id: BOUND, name: "general", botIsMember: true }],
    ...opts,
  });

describe("slack thread visibility from a channel turn", () => {
  /**
   * TEST_SCENARIO: The whole round trip, because the halves are worthless
   * apart. The id is the load-bearing part, so the test takes it back out of
   * the rendered prompt and calls the tool with exactly that: a marker the
   * agent could not act on fails here rather than in a channel. The reverse
   * holds too — a ts that never carried a tag is refused, since what a tag
   * offers is the only thing the tool reaches.
   */
  it("marks the line hiding replies, and the id it prints is the one that reads them", async () => {
    const h = harness();
    h.gw.setThreadedHistory([
      {
        ts: ASK_TS,
        user: "U999",
        text: ASK,
        threadTs: ASK_TS,
        replyCount: 2,
        latestReplyTs: HUMAN_REPLY_TS,
      },
      {
        ts: AGENT_REPLY_TS,
        user: "U-BOT",
        text: AGENT_REPLY,
        threadTs: ASK_TS,
        blocks: [
          agentContextBlock({
            uiBaseUrl: "http://ui",
            agentId: "agent-1",
            label: "Helper - Powered by DAM",
          }),
        ],
      },
      { ts: HUMAN_REPLY_TS, user: "U777", text: HUMAN_REPLY, threadTs: ASK_TS },
      { ts: LUNCH_TS, user: "U888", text: LUNCH },
    ]);

    await h.worker.connect();
    await h.gw.fireMention({
      user: "U888",
      channel: BOUND,
      ts: MENTION_TS,
      text: "hey agent",
    });

    const prompt = String(h.prompts[0]);

    expect(prompt).toContain(
      `${ASK} [thread: 2 replies, latest ${formatSlackTs(HUMAN_REPLY_TS)}, ` +
        `ts ${ASK_TS}]`,
    );
    expect(prompt).not.toContain(AGENT_REPLY);
    expect(prompt).not.toContain(HUMAN_REPLY);
    expect(prompt).toContain(`${LUNCH}\n`);
    expect(prompt).toContain("read_thread");

    const printed = /\[thread: \d+ repl(?:y|ies), latest .+?, ts ([\d.]+)\]/
      .exec(prompt)
      ?.at(1);
    expect(printed).toBe(ASK_TS);

    const thread = await h.worker.readThread("agent-1", {
      threadTs: printed!,
    });

    const unoffered = await h.worker.readThread("agent-1", {
      threadTs: LUNCH_TS,
    });
    expect(unoffered).toEqual({
      error:
        "not a thread you were shown — only a ts taken from a " +
        "[thread: ...] tag in the conversation history handed to you " +
        "can be read, and offers age out. If someone wants you on an " +
        "older thread, ask them to reply in it — it will reach you " +
        "with its full history",
    });

    expect(thread).toEqual({
      conversationId: BOUND,
      threadTs: ASK_TS,
      hasMore: false,
      messages: [
        `U999 [${formatSlackTs(ASK_TS)}]: ${ASK}`,
        `you (this agent) [${formatSlackTs(AGENT_REPLY_TS)}]: ${AGENT_REPLY}`,
        `U777 [${formatSlackTs(HUMAN_REPLY_TS)}]: ${HUMAN_REPLY}`,
      ],
    });
  });

  /**
   * TEST_SCENARIO: An offer retires on age alone. A catch-up after a long
   * absence can hand over hundreds of tagged parents in one block; every tag
   * of that block must resolve, and the block must not revoke a tag shown
   * before it — that earlier tag still sits in the session's own history.
   */
  it("keeps an offer live until it ages out, however large a later block", async () => {
    const h = harness({ ambient: true });
    const earlyParent = {
      ts: "50.000000",
      user: "U777",
      text: "pre-existing question",
      threadTs: "50.000000",
      replyCount: 1,
    };
    const opener = { ts: "100.000000", user: "U999", text: "morning all" };
    h.gw.setThreadedHistory([earlyParent, opener]);

    await h.worker.connect();
    await h.gw.fireMessage({
      user: "U999",
      channel: BOUND,
      ts: "100.000000",
      text: "morning all",
    });
    expect(await h.settled(() => h.prompts.length === 1)).toBe(true);
    expect(String(h.prompts[0])).toContain(
      "pre-existing question [thread: 1 reply, ts 50.000000]",
    );

    const parents = Array.from({ length: 60 }, (_, i) => ({
      ts: `${200 + i}.000000`,
      user: "U777",
      text: `question ${i}`,
      threadTs: `${200 + i}.000000`,
      replyCount: 1,
    }));
    h.gw.setThreadedHistory([
      earlyParent,
      opener,
      ...parents,
      { ts: "900.000000", user: "U888", text: "back to work" },
    ]);
    await h.gw.fireMessage({
      user: "U888",
      channel: BOUND,
      ts: "900.000000",
      text: "back to work",
    });
    expect(await h.settled(() => h.prompts.length === 2)).toBe(true);

    const catchUp = String(h.prompts[1]);
    expect(catchUp).toContain("question 0 [thread: 1 reply, ts 200.000000]");
    expect(catchUp).toContain("question 59 [thread: 1 reply, ts 259.000000]");

    const oldest = await h.worker.readThread("agent-1", {
      threadTs: "200.000000",
    });
    expect(oldest).toMatchObject({
      conversationId: BOUND,
      threadTs: "200.000000",
    });

    const early = await h.worker.readThread("agent-1", {
      threadTs: "50.000000",
    });
    expect(early).toMatchObject({
      conversationId: BOUND,
      threadTs: "50.000000",
    });
  });
});
