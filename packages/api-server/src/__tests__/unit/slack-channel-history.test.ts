import { describe, it, expect } from "vitest";
import { configureLogger } from "../../core/logger.js";
import type { SlackMessage } from "../../modules/channels/infrastructure/slack-gateway.js";
import {
  SLACK_HARNESS_OWNER,
  slackWorkerHarness,
} from "../helpers/slack-worker.js";

configureLogger({ level: "error", write: () => {} });

const BOUND = "C1";
const OTHER = "C2";

const tsAt = (i: number) => `${1758000000 + i * 60}.000000`;

const topLevel = (count: number): SlackMessage[] =>
  Array.from({ length: count }, (_, i) => ({
    ts: tsAt(i),
    user: "U777",
    text: `message ${i}`,
  }));

type Read = {
  messages: string[];
  conversationId: string;
  hasMore: boolean;
  cursor?: string;
};

/**
 * TEST_OVERVIEW: Channel history, an opt-in on one Agent's Slack binding.
 * Where it is on, read_channel_history reads that conversation's top-level
 * messages back in time, page by page, and every thread a page shows becomes
 * readable with read_thread; a turn there names the tool. Where it is off —
 * the default — the Agent reaches nothing past the window it is handed. The
 * in-chat command turns it on and off for the person who connected the Agent
 * or its owner, and the conversation's agent list says who has it.
 */
const harness = (opts: Parameters<typeof slackWorkerHarness>[0] = {}) =>
  slackWorkerHarness({
    boundChannelId: BOUND,
    channels: [{ id: BOUND, name: "general", botIsMember: true }],
    ...opts,
  });

describe("what read_channel_history reaches", () => {
  /**
   * TEST_SCENARIO: The opt-in is per conversation, so a second conversation
   * the Agent is bound to without it stays closed, and the refusal names the
   * one that is open so the Agent can tell the person where it can look.
   */
  it("reads a conversation with history on and refuses one without, naming where it is on", async () => {
    const h = harness({ history: true, otherBound: [OTHER] });
    h.gw.setThreadedHistory(topLevel(3));
    await h.worker.connect();

    const read = (await h.worker.readChannelHistory("agent-1", {})) as Read;
    expect(read.conversationId).toBe(BOUND);
    expect(read.hasMore).toBe(false);
    expect(read.messages).toHaveLength(3);
    expect(read.messages[0]).toContain(`ts ${tsAt(0)}]: message 0`);
    expect(read.messages[2]).toContain("message 2");

    const refused = await h.worker.readChannelHistory("agent-1", {
      conversationId: OTHER,
    });
    expect(refused).toEqual({
      error: expect.stringContaining(
        `channel history is not on for you in ${OTHER}`,
      ),
    });
    expect((refused as { error: string }).error).toContain(
      `it is on for you in ${BOUND}`,
    );
  });

  /**
   * TEST_SCENARIO: Turning history off must close the tool at once, even for
   * a session that still lists it, because the check runs on every call.
   */
  it("is off by default, and refuses every read once it is turned off", async () => {
    const never = harness();
    never.gw.setThreadedHistory(topLevel(3));
    await never.worker.connect();
    expect(await never.worker.readChannelHistory("agent-1", {})).toEqual({
      error: expect.stringContaining("it is on nowhere for you"),
    });

    const h = harness({ history: true });
    h.gw.setThreadedHistory(topLevel(3));
    await h.worker.connect();
    expect(await h.worker.readChannelHistory("agent-1", {})).toMatchObject({
      conversationId: BOUND,
    });
    h.history.on = false;
    expect(
      await h.worker.readChannelHistory("agent-1", { conversationId: BOUND }),
    ).toEqual({ error: expect.stringContaining(`not on for you in ${BOUND}`) });
  });
});

describe("paging back through a conversation", () => {
  /**
   * TEST_SCENARIO: A page is the newest window, so the older messages are
   * reached only by the cursor it returns; a cursor names its conversation,
   * so one from elsewhere is refused rather than read against this one.
   */
  it("pages back with the cursor it returns and refuses a cursor from another conversation", async () => {
    const h = harness({ history: true });
    h.gw.setThreadedHistory(topLevel(130));
    await h.worker.connect();

    const first = (await h.worker.readChannelHistory("agent-1", {})) as Read;
    expect(first.messages).toHaveLength(100);
    expect(first.messages[0]).toContain("message 30");
    expect(first.messages[99]).toContain("message 129");
    expect(first.hasMore).toBe(true);
    expect(first.cursor).toBeDefined();

    const second = (await h.worker.readChannelHistory("agent-1", {
      cursor: first.cursor!,
    })) as Read;
    expect(second.messages).toHaveLength(30);
    expect(second.messages[0]).toContain("message 0");
    expect(second.messages[29]).toContain("message 29");
    expect(second.hasMore).toBe(false);
    expect(second.cursor).toBeUndefined();

    for (const cursor of [`C9:${tsAt(5)}`, "not a cursor"]) {
      expect(
        await h.worker.readChannelHistory("agent-1", {
          conversationId: BOUND,
          cursor,
        }),
      ).toEqual({ error: expect.stringContaining("that cursor is not one") });
    }
  });

  it("reads one stretch of time", async () => {
    const h = harness({ history: true });
    h.gw.setThreadedHistory(topLevel(30));
    await h.worker.connect();

    const read = (await h.worker.readChannelHistory("agent-1", {
      since: tsAt(10),
      until: tsAt(20),
    })) as Read;
    expect(read.messages).toHaveLength(10);
    expect(read.messages[0]).toContain("message 10");
    expect(read.messages[9]).toContain("message 19");
  });
});

describe("threads a page shows", () => {
  /**
   * TEST_SCENARIO: A decision often lives in a thread whose opener is far
   * older than the window, which read_thread alone refuses. Showing the
   * thread's tag on a page is what lets the Agent open it.
   */
  it("makes a thread it shows readable with read_thread", async () => {
    const h = harness({ history: true });
    h.gw.setThreadedHistory([
      {
        ts: tsAt(0),
        user: "U999",
        text: "when do we ship",
        threadTs: tsAt(0),
        replyCount: 1,
        latestReplyTs: tsAt(1),
      },
      {
        ts: tsAt(1),
        user: "U777",
        text: "friday, decided",
        threadTs: tsAt(0),
      },
      { ts: tsAt(2), user: "U888", text: "lunch?" },
    ]);
    await h.worker.connect();

    expect(await h.worker.readThread("agent-1", { threadTs: tsAt(0) })).toEqual(
      { error: expect.stringContaining("not a thread you were shown") },
    );

    const page = (await h.worker.readChannelHistory("agent-1", {})) as Read;
    expect(page.messages[0]).toContain("[thread: 1 reply");
    expect(page.messages[0]).toContain(`ts ${tsAt(0)}]`);
    expect(page.messages.join("\n")).not.toContain("friday, decided");

    const thread = (await h.worker.readThread("agent-1", {
      threadTs: tsAt(0),
    })) as { messages: string[] };
    expect(thread.messages.join("\n")).toContain("friday, decided");
  });
});

describe("what a turn is told", () => {
  /**
   * TEST_SCENARIO: An Agent asked inside a thread is handed only that thread,
   * so it learns that it can look further back only from its turn's contract.
   */
  it("names read_channel_history with the conversation's chatId only where history is on", async () => {
    const on = harness({ history: true });
    await on.worker.connect();
    await on.gw.fireMention({
      user: "U888",
      channel: BOUND,
      ts: tsAt(200),
      threadTs: tsAt(150),
      text: "what did we decide about shipping",
    });
    expect(String(on.prompts[0])).toContain(
      `read_channel_history (chatId="${BOUND}")`,
    );

    const off = harness();
    await off.worker.connect();
    await off.gw.fireMention({
      user: "U888",
      channel: BOUND,
      ts: tsAt(200),
      text: "what did we decide about shipping",
    });
    expect(String(off.prompts[0])).not.toContain("read_channel_history");
  });

  it("hands a top-level turn the newest 100 top-level messages", async () => {
    const h = harness();
    h.gw.setThreadedHistory(topLevel(130));
    await h.worker.connect();
    await h.gw.fireMention({
      user: "U888",
      channel: BOUND,
      ts: tsAt(200),
      text: "hey agent",
    });
    const prompt = String(h.prompts[0]);
    expect(prompt).toMatch(/: message 30$/m);
    expect(prompt).toMatch(/: message 129$/m);
    expect(prompt).not.toMatch(/: message 29$/m);
  });
});

describe("/dam history", () => {
  /**
   * TEST_SCENARIO: The setting is the binder's or owner's call, made like
   * ambient mode: confirmed to them alone, nothing posted in the channel,
   * and visible to every member in the agent list.
   */
  it("lets the agent's owner turn it on, confirms to them alone, and /dam who shows it", async () => {
    const h = harness({ linkedSub: SLACK_HARNESS_OWNER });
    await h.worker.connect();

    expect(
      await h.gw.fireCommand({
        text: "history",
        userId: "U1",
        channelId: BOUND,
      }),
    ).toContain("is off —");

    const ack = await h.gw.fireCommand({
      text: "history on",
      userId: "U1",
      channelId: BOUND,
    });
    expect(ack).toContain("Channel history turned on");
    expect(ack).toContain("/dam history Helper off");
    expect(h.historyCalls).toEqual([
      { agentId: "agent-1", channelId: BOUND, history: true },
    ]);
    expect(
      h.gw.readOutbound().filter((r) => r.kind === "message"),
    ).toHaveLength(0);

    expect(
      await h.gw.fireCommand({ text: "who", userId: "U2", channelId: BOUND }),
    ).toContain("Can read this conversation's history.");
  });

  it("refuses a linked person who neither connected the agent nor owns it", async () => {
    const h = harness({ linkedSub: "kc|member-2" });
    await h.worker.connect();

    expect(
      await h.gw.fireCommand({
        text: "history on",
        userId: "U2",
        channelId: BOUND,
      }),
    ).toContain("Only the person who connected this channel");
    expect(h.historyCalls).toEqual([]);
  });
});
