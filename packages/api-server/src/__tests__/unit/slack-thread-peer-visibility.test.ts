import { createMemoryTtlStore } from "../../core/ttl-store.js";
import { describe, it, expect } from "vitest";
import type { AgentsService } from "api-server-api";
import { SessionType, slackThreadKey } from "api-server-api";
import type { ContentBlock } from "@agentclientprotocol/sdk/dist/schema/types.gen.js";
import { createSlackWorker } from "../../modules/channels/infrastructure/slack.js";
import { createFakeSlackGateway } from "../../modules/channels/infrastructure/fake-slack-gateway.js";
import { stubTurnAttendance } from "../helpers/turn-attendance.js";
import { stubWorkspaceFiles } from "../helpers/workspace-files.js";
import { agentContextBlock } from "../../modules/channels/infrastructure/agent-footer.js";
import type { AcpClient, AcpSessionInfo } from "../../core/acp-client.js";
import { configureLogger } from "../../core/logger.js";
import type { StoredChannelConfig } from "../../modules/channels/stored-channel.js";

configureLogger({ level: "error", write: () => {} });

const OWNER = "kc|owner-1";
const FOOTER_LABEL = "Powered by DAM";
const CHANNEL = "C1";
const THREAD_TS = "1.0";
const THREAD_KEY = slackThreadKey(CHANNEL, THREAD_TS);

const SELF = "agent-1";
const PEER = "agent-99";

const PEER_WORDS = "I already rolled the deploy back";
const OLD_WORDS = "deploy looks broken";

/**
 * TEST_OVERVIEW: What an agent taking a later turn in a Slack thread can see of
 * what was said there while it was away — by a peer agent or by a person. A
 * thread maps to one resumable session per agent, so only an agent's first turn
 * in a thread opens a fresh session and receives the thread's history, and a
 * mention-only binding is never relayed a message that doesn't tag it. These
 * tests pin what the later, resumed turns are handed: what arrived since that
 * agent's own last turn, attributed, and nothing it has already seen.
 */
function harness(existingSessions: AcpSessionInfo[] = [], soleAgent = false) {
  const gw = createFakeSlackGateway();
  const prompts: Array<{ resumed: boolean; text: string }> = [];
  const created: AcpSessionInfo[] = [];

  const failSends = { count: 0 };
  const acp: AcpClient = {
    steer: async () => "unsupported" as const,
    listSessions: async () => [...existingSessions, ...created],
    sendPrompt: async (prompt: string | ContentBlock[], opts) => {
      if (failSends.count > 0) {
        failSends.count -= 1;
        throw new Error("acp prompt failed");
      }
      const text =
        typeof prompt === "string"
          ? prompt
          : prompt.map((b) => ("text" in b ? String(b.text) : "")).join("\n");
      prompts.push({ resumed: "resumeSessionId" in opts, text });
      if ("platformMeta" in opts && opts.platformMeta) {
        created.push({
          sessionId: `s-${created.length + 1}`,
          platform: opts.platformMeta,
        } as AcpSessionInfo);
      }
      return "the answer";
    },
    triggerSession: () => Promise.reject(new Error("unused")),
  };

  const AGENT_NAMES: Record<string, string> = {
    [SELF]: "Helper",
    [PEER]: "Ops",
  };
  const agents = {
    ensureReady: async () => {},
    get: async (id: string) =>
      AGENT_NAMES[id] ? { id, name: AGENT_NAMES[id] } : null,
  } as unknown as AgentsService;

  const failThreadReads = { count: 0 };
  const gateway = {
    ...gw,
    getThreadReplies: async (
      args: Parameters<typeof gw.getThreadReplies>[0],
    ) => {
      if (failThreadReads.count > 0) {
        failThreadReads.count -= 1;
        throw new Error("slack conversations.replies unavailable");
      }
      return gw.getThreadReplies(args);
    },
  };

  const worker = createSlackWorker(
    () => acp,
    () => gateway,
    () => agents,
    { resolve: async () => null } as never,
    { authUrl: "http://kc", clientId: "c" } as never,
    createMemoryTtlStore(600_000),
    async () => OWNER,
    {
      resolveSlackBindings: async () =>
        soleAgent
          ? [
              {
                instanceName: SELF,
                owner: OWNER,
                ambient: false,
                isDefault: true,
              },
            ]
          : [
              {
                instanceName: SELF,
                owner: OWNER,
                ambient: false,
                isDefault: true,
              },
              {
                instanceName: PEER,
                owner: OWNER,
                ambient: false,
                isDefault: false,
              },
            ],
      resolveSlackChannelsByInstance: async () => [CHANNEL],
    } as never,
    async () => {},
    async () => {},
    async () => true,
    { name: "DAM", short: "dam" },
    async () => true,
    "http://ui",
    stubTurnAttendance(),
    stubWorkspaceFiles(),
    () => {},
  );

  return { gw, prompts, worker, failThreadReads, failSends };
}

function footered(agentId: string, ts: string, text: string) {
  return {
    ts,
    user: "U-BOT",
    text,
    blocks: [
      agentContextBlock({
        uiBaseUrl: "http://ui",
        agentId,
        label: FOOTER_LABEL,
      }),
    ],
  };
}

function boundSession(): AcpSessionInfo {
  return {
    sessionId: "s-existing",
    platform: { type: SessionType.ChannelSlack, threadTs: THREAD_KEY },
  } as AcpSessionInfo;
}

function mention(ts: string, text: string, inThread = true) {
  return {
    user: "U999",
    channel: CHANNEL,
    ts,
    ...(inThread ? { threadTs: THREAD_TS } : {}),
    text,
  };
}

describe("what a later mention turn sees of a thread it was away from", () => {
  /**
   * TEST_SCENARIO: The reported sequence. A human opens a thread and mentions
   * agent A, which answers. The human then mentions agent B in the same thread,
   * and B answers. The human comes back to A. A's second turn resumes the
   * session it opened on its first, and is handed what arrived in between —
   * B's reply, attributed to B, and the message that prompted it.
   */
  it("hands a resuming agent the peer's post that arrived while it was away", async () => {
    const h = harness();
    await h.worker.start(SELF, {} as StoredChannelConfig);

    h.gw.setHistory([{ ts: THREAD_TS, user: "U999", text: OLD_WORDS }]);
    await h.gw.fireMention(
      mention(THREAD_TS, "<@U-BOT> Helper can you look", false),
    );
    expect(h.prompts).toHaveLength(1);
    expect(h.prompts[0]!.resumed).toBe(false);

    h.gw.setHistory([
      { ts: THREAD_TS, user: "U999", text: OLD_WORDS },
      footered(SELF, "1.1", "looking now"),
      { ts: "1.2", user: "U999", text: "<@U-BOT> Ops what do you think" },
      footered(PEER, "1.3", PEER_WORDS),
    ]);
    await h.gw.fireMention(mention("1.4", "<@U-BOT> Helper so are we clear"));

    expect(h.prompts).toHaveLength(2);
    const second = h.prompts[1]!;

    expect(second.resumed).toBe(true);
    expect(second.text).toContain("<context>");
    expect(second.text).toContain(PEER_WORDS);
    expect(second.text).toContain("Ops (another agent)");
    expect(second.text).toContain("what do you think");
    expect(second.text).toContain("after your last turn");
    expect(second.text).toContain("so are we clear");
  });

  /**
   * TEST_SCENARIO: The catch-up is bounded by the agent's own last turn, not by
   * the thread's start. Re-showing what the resumed session already holds would
   * duplicate it, so the message that opened the thread and the agent's own
   * reply to it stay out.
   */
  it("leaves out what the resuming agent has already seen", async () => {
    const h = harness();
    await h.worker.start(SELF, {} as StoredChannelConfig);

    h.gw.setHistory([{ ts: THREAD_TS, user: "U999", text: OLD_WORDS }]);
    await h.gw.fireMention(
      mention(THREAD_TS, "<@U-BOT> Helper can you look", false),
    );

    h.gw.setHistory([
      { ts: THREAD_TS, user: "U999", text: OLD_WORDS },
      footered(SELF, "1.1", "looking now"),
      footered(PEER, "1.3", PEER_WORDS),
    ]);
    await h.gw.fireMention(mention("1.4", "<@U-BOT> Helper so are we clear"));

    const second = h.prompts[1]!;
    expect(second.text).toContain(PEER_WORDS);
    expect(second.text).not.toContain(OLD_WORDS);
    expect(second.text).not.toContain("looking now");
  });

  /**
   * TEST_SCENARIO: Nothing arrived since the agent's last turn — the ordinary
   * back-and-forth where one agent holds the thread alone. The turn carries no
   * history block at all, so an uneventful thread costs nothing.
   */
  it("adds no history block when nothing arrived since the last turn", async () => {
    const h = harness();
    await h.worker.start(SELF, {} as StoredChannelConfig);

    h.gw.setHistory([{ ts: THREAD_TS, user: "U999", text: OLD_WORDS }]);
    await h.gw.fireMention(
      mention(THREAD_TS, "<@U-BOT> Helper can you look", false),
    );

    h.gw.setHistory([
      { ts: THREAD_TS, user: "U999", text: OLD_WORDS },
      footered(SELF, "1.1", "looking now"),
    ]);
    await h.gw.fireMention(mention("1.4", "<@U-BOT> Helper anything else"));

    const second = h.prompts[1]!;
    expect(second.resumed).toBe(true);
    expect(second.text).not.toContain("<context>");
    expect(second.text).toContain("anything else");
  });

  /**
   * TEST_SCENARIO: The worker holds the per-thread watermark in its own process,
   * so a restart or a lease handover loses it while the agent's session lives
   * on. The agent's own last post in the thread stands in for it — recovering
   * the peer's reply without replaying the whole thread.
   */
  it("falls back to the agent's own last post when the watermark is lost", async () => {
    const h = harness([boundSession()]);
    await h.worker.start(SELF, {} as StoredChannelConfig);

    h.gw.setHistory([
      { ts: THREAD_TS, user: "U999", text: OLD_WORDS },
      footered(SELF, "1.1", "looking now"),
      footered(PEER, "1.3", PEER_WORDS),
    ]);
    await h.gw.fireMention(mention("1.4", "<@U-BOT> Helper so are we clear"));

    expect(h.prompts).toHaveLength(1);
    const only = h.prompts[0]!;
    expect(only.resumed).toBe(true);
    expect(only.text).toContain(PEER_WORDS);
    expect(only.text).toContain("Ops (another agent)");
    expect(only.text).not.toContain(OLD_WORDS);
  });

  /**
   * TEST_SCENARIO: No second agent needed. A mention-only binding is never
   * relayed a thread message that doesn't tag it, so people talking to each
   * other in the thread — the ordinary way a thread goes — were invisible to
   * the agent on every turn after its first. It is the same gap as the
   * multi-agent one, and the common case: one agent, one channel, humans
   * talking. The catch-up carries those messages under their Slack ids.
   */
  it("carries a human's untagged thread message that was never relayed", async () => {
    const h = harness([], true);
    await h.worker.start(SELF, {} as StoredChannelConfig);

    h.gw.setHistory([{ ts: THREAD_TS, user: "U999", text: OLD_WORDS }]);
    await h.gw.fireMention(
      mention(THREAD_TS, "<@U-BOT> Helper can you look", false),
    );
    expect(h.prompts).toHaveLength(1);

    h.gw.setHistory([
      { ts: THREAD_TS, user: "U999", text: OLD_WORDS },
      footered(SELF, "1.1", "looking now"),
      { ts: "1.2", user: "U555", text: "we rolled it back by hand already" },
    ]);
    await h.gw.fireMention(mention("1.4", "<@U-BOT> Helper where are we"));

    expect(h.prompts).toHaveLength(2);
    const second = h.prompts[1]!;
    expect(second.resumed).toBe(true);
    expect(second.text).toContain("we rolled it back by hand already");
    expect(second.text).toContain("U555 [");
    expect(second.text).not.toContain("looking now");
  });

  /**
   * TEST_SCENARIO: A first turn in a thread is unchanged — it opens a fresh
   * session and still receives the thread's full history, attributed. The fix
   * adds to the resumed path without altering the cold one.
   */
  it("still gives an agent opening a fresh session the whole thread", async () => {
    const h = harness();
    await h.worker.start(SELF, {} as StoredChannelConfig);

    h.gw.setHistory([
      { ts: THREAD_TS, user: "U999", text: OLD_WORDS },
      footered(PEER, "1.3", PEER_WORDS),
    ]);
    await h.gw.fireMention(mention("1.4", "<@U-BOT> Helper so are we clear"));

    expect(h.prompts).toHaveLength(1);
    const only = h.prompts[0]!;
    expect(only.resumed).toBe(false);
    expect(only.text).toContain("<context>");
    expect(only.text).toContain("Ops (another agent)");
    expect(only.text).toContain(PEER_WORDS);
    expect(only.text).toContain(OLD_WORDS);
  });

  /**
   * TEST_SCENARIO: A thread longer than one page of replies. Slack returns a
   * thread oldest-first, so reading a fixed page of it hands back the thread's
   * beginning — all of it older than the boundary, leaving the catch-up empty
   * exactly where it is needed most, in the long busy threads several agents
   * work. The read is anchored at the boundary instead, so what arrived after
   * it is what comes back.
   */
  it("finds the peer's post in a thread longer than one page of replies", async () => {
    const h = harness();
    await h.worker.start(SELF, {} as StoredChannelConfig);

    const filler = Array.from({ length: 55 }, (_, i) => ({
      ts: `1.${String(i + 1).padStart(2, "0")}`,
      user: "U555",
      text: `chatter ${i + 1}`,
    }));

    h.gw.setHistory([{ ts: THREAD_TS, user: "U999", text: OLD_WORDS }]);
    await h.gw.fireMention(
      mention(THREAD_TS, "<@U-BOT> Helper can you look", false),
    );

    h.gw.setHistory([
      { ts: THREAD_TS, user: "U999", text: OLD_WORDS },
      ...filler,
      { ts: "1.56", user: "U999", text: "<@U-BOT> Helper still there" },
    ]);
    await h.gw.fireMention(mention("1.56", "<@U-BOT> Helper still there"));

    h.gw.setHistory([
      { ts: THREAD_TS, user: "U999", text: OLD_WORDS },
      ...filler,
      { ts: "1.56", user: "U999", text: "<@U-BOT> Helper still there" },
      footered(PEER, "1.6", PEER_WORDS),
    ]);
    await h.gw.fireMention(mention("1.61", "<@U-BOT> Helper so are we clear"));

    expect(h.prompts).toHaveLength(3);
    const third = h.prompts[2]!;
    expect(third.resumed).toBe(true);
    expect(third.text).toContain(PEER_WORDS);
    expect(third.text).toContain("Ops (another agent)");
    expect(third.text).not.toContain("chatter 1 ");
  });

  /**
   * TEST_SCENARIO: Slack refusing the catch-up read must not cost the agent the
   * messages. The boundary only moves once the messages behind it have actually
   * been read, so a failed turn leaves it where it was and the next turn picks
   * the same window up — rather than stepping over it and dropping the peer's
   * reply for good.
   */
  it("keeps the unseen boundary where it was when the read fails", async () => {
    const h = harness();
    await h.worker.start(SELF, {} as StoredChannelConfig);

    h.gw.setHistory([{ ts: THREAD_TS, user: "U999", text: OLD_WORDS }]);
    await h.gw.fireMention(
      mention(THREAD_TS, "<@U-BOT> Helper can you look", false),
    );

    h.gw.setHistory([
      { ts: THREAD_TS, user: "U999", text: OLD_WORDS },
      footered(SELF, "1.1", "looking now"),
      footered(PEER, "1.3", PEER_WORDS),
    ]);

    h.failThreadReads.count = 1;
    await h.gw.fireMention(mention("1.4", "<@U-BOT> Helper any news"));

    expect(h.prompts).toHaveLength(2);
    expect(h.prompts[1]!.text).not.toContain(PEER_WORDS);

    await h.gw.fireMention(mention("1.5", "<@U-BOT> Helper so are we clear"));

    expect(h.prompts).toHaveLength(3);
    const third = h.prompts[2]!;
    expect(third.resumed).toBe(true);
    expect(third.text).toContain(PEER_WORDS);
    expect(third.text).toContain("Ops (another agent)");
  });

  /**
   * TEST_SCENARIO: More arrived than one read returns. The boundary may only
   * move as far as the read actually reached — stepping it to the triggering
   * message would skip the surplus and then step over it for good, which is the
   * loss the boundary exists to prevent. The surplus is carried by the turn
   * after instead, so a burst costs an extra turn rather than the messages.
   */
  it("moves the boundary no further than a capped read reached", async () => {
    const h = harness();
    await h.worker.start(SELF, {} as StoredChannelConfig);

    const flood = Array.from({ length: 59 }, (_, i) => ({
      ts: `1.${String(i + 1).padStart(3, "0")}`,
      user: "U555",
      text: `chatter ${i + 1}`,
    }));
    const late = footered(PEER, "1.060", PEER_WORDS);

    h.gw.setHistory([{ ts: THREAD_TS, user: "U999", text: OLD_WORDS }]);
    await h.gw.fireMention(mention(THREAD_TS, "<@U-BOT> Helper look", false));

    h.gw.setHistory([
      { ts: THREAD_TS, user: "U999", text: OLD_WORDS },
      ...flood,
      late,
      { ts: "1.061", user: "U999", text: "<@U-BOT> Helper still there" },
    ]);
    await h.gw.fireMention(mention("1.061", "<@U-BOT> Helper still there"));

    expect(h.prompts).toHaveLength(2);
    expect(h.prompts[1]!.resumed).toBe(true);
    expect(h.prompts[1]!.text).not.toContain(PEER_WORDS);

    h.gw.setHistory([
      { ts: THREAD_TS, user: "U999", text: OLD_WORDS },
      ...flood,
      late,
      { ts: "1.061", user: "U999", text: "<@U-BOT> Helper still there" },
      { ts: "1.062", user: "U999", text: "<@U-BOT> Helper so are we clear" },
    ]);
    await h.gw.fireMention(mention("1.062", "<@U-BOT> Helper so are we clear"));

    expect(h.prompts).toHaveLength(3);
    const third = h.prompts[2]!;
    expect(third.resumed).toBe(true);
    expect(third.text).toContain(PEER_WORDS);
    expect(third.text).toContain("Ops (another agent)");
  });

  /**
   * TEST_SCENARIO: The first turn in a long thread reads a capped page too, so
   * it is subject to the same rule as the catch-up: the boundary may only move
   * as far as the read reached. A cold turn that jumps the boundary to its
   * triggering message strands everything the thread already held beyond the
   * cap, and the resumes after it never look that far back again.
   */
  it("moves the boundary no further than a cold read reached", async () => {
    const h = harness();
    await h.worker.start(SELF, {} as StoredChannelConfig);

    const filler = Array.from({ length: 60 }, (_, i) => ({
      ts: `1.${String(i + 1).padStart(3, "0")}`,
      user: "U555",
      text: `chatter ${i + 1}`,
    }));

    h.gw.setHistory([
      { ts: "1.000", user: "U999", text: OLD_WORDS },
      ...filler,
      footered(PEER, "1.061", PEER_WORDS),
      { ts: "1.062", user: "U999", text: "<@U-BOT> Helper can you look" },
    ]);
    await h.gw.fireMention(mention("1.062", "<@U-BOT> Helper can you look"));

    expect(h.prompts).toHaveLength(1);
    expect(h.prompts[0]!.resumed).toBe(false);
    expect(h.prompts[0]!.text).not.toContain(PEER_WORDS);

    h.gw.setHistory([
      { ts: "1.000", user: "U999", text: OLD_WORDS },
      ...filler,
      footered(PEER, "1.061", PEER_WORDS),
      { ts: "1.062", user: "U999", text: "<@U-BOT> Helper can you look" },
      { ts: "1.063", user: "U999", text: "<@U-BOT> Helper so are we clear" },
    ]);
    await h.gw.fireMention(mention("1.063", "<@U-BOT> Helper so are we clear"));

    expect(h.prompts).toHaveLength(2);
    const second = h.prompts[1]!;
    expect(second.resumed).toBe(true);
    expect(second.text).toContain(PEER_WORDS);
    expect(second.text).toContain("Ops (another agent)");
  });

  /**
   * TEST_SCENARIO: The turn is built but never reaches the agent. Reading the
   * messages is not the same as delivering them, so a boundary recorded while
   * the prompt is assembled steps over messages a failed send never carried.
   * It moves on the send's success instead, leaving a failed turn's window for
   * the next one to pick up.
   */
  it("keeps the boundary where it was when the send fails", async () => {
    const h = harness();
    await h.worker.start(SELF, {} as StoredChannelConfig);

    h.gw.setHistory([{ ts: THREAD_TS, user: "U999", text: OLD_WORDS }]);
    await h.gw.fireMention(
      mention(THREAD_TS, "<@U-BOT> Helper can you look", false),
    );
    expect(h.prompts).toHaveLength(1);

    h.gw.setHistory([
      { ts: THREAD_TS, user: "U999", text: OLD_WORDS },
      footered(SELF, "1.1", "looking now"),
      footered(PEER, "1.3", PEER_WORDS),
    ]);

    h.failSends.count = 2;
    await h.gw.fireMention(mention("1.4", "<@U-BOT> Helper any news"));
    expect(h.prompts).toHaveLength(1);

    await h.gw.fireMention(mention("1.5", "<@U-BOT> Helper so are we clear"));

    expect(h.prompts).toHaveLength(2);
    const later = h.prompts[1]!;
    expect(later.text).toContain(PEER_WORDS);
    expect(later.text).toContain("Ops (another agent)");
  });

  /**
   * TEST_SCENARIO: The tail read spans pages. A paged read that keeps only the
   * page it happened to end on returns whatever remainder the thread's length
   * left over — a handful of messages, not the newest window it was asked for —
   * so an own post sitting earlier in that window goes unseen and the stand-in
   * finds nothing. The read keeps a rolling window across pages instead.
   */
  it("keeps a rolling window across pages of the tail read", async () => {
    const h = harness([boundSession()]);
    await h.worker.start(SELF, {} as StoredChannelConfig);

    const before = Array.from({ length: 79 }, (_, i) => ({
      ts: `1.${String(i + 1).padStart(3, "0")}`,
      user: "U555",
      text: `chatter ${i + 1}`,
    }));
    const after = Array.from({ length: 38 }, (_, i) => ({
      ts: `1.${String(i + 82).padStart(3, "0")}`,
      user: "U555",
      text: `later ${i + 1}`,
    }));

    h.gw.setHistory([
      { ts: "1.000", user: "U999", text: OLD_WORDS },
      ...before,
      footered(SELF, "1.080", "looking now"),
      footered(PEER, "1.081", PEER_WORDS),
      ...after,
      { ts: "1.120", user: "U999", text: "<@U-BOT> Helper so are we clear" },
    ]);
    await h.gw.fireMention(mention("1.120", "<@U-BOT> Helper so are we clear"));

    expect(h.prompts).toHaveLength(1);
    const only = h.prompts[0]!;
    expect(only.resumed).toBe(true);
    expect(only.text).toContain(PEER_WORDS);
    expect(only.text).toContain("Ops (another agent)");
  });

  /**
   * TEST_SCENARIO: Slack repeats the thread's opening message in every page, so
   * a fold that counts what it is handed spends a slot of its window on that
   * repeat per page and keeps fewer real messages than it was asked for — the
   * oldest of them, the agent's own last post among them, falling off the end.
   * The window counts distinct messages, so the repeat costs nothing.
   */
  it("counts distinct messages against the window, not the repeated parent", async () => {
    const h = harness([boundSession()]);
    await h.worker.start(SELF, {} as StoredChannelConfig);

    const before = Array.from({ length: 71 }, (_, i) => ({
      ts: `1.${String(i + 1).padStart(3, "0")}`,
      user: "U555",
      text: `chatter ${i + 1}`,
    }));
    const after = Array.from({ length: 47 }, (_, i) => ({
      ts: `1.${String(i + 74).padStart(3, "0")}`,
      user: "U555",
      text: `later ${i + 1}`,
    }));

    h.gw.setHistory([
      { ts: "1.000", user: "U999", text: OLD_WORDS },
      ...before,
      footered(SELF, "1.072", "looking now"),
      footered(PEER, "1.073", PEER_WORDS),
      ...after,
      { ts: "1.121", user: "U999", text: "<@U-BOT> Helper so are we clear" },
    ]);
    await h.gw.fireMention(mention("1.121", "<@U-BOT> Helper so are we clear"));

    expect(h.prompts).toHaveLength(1);
    const only = h.prompts[0]!;
    expect(only.resumed).toBe(true);
    expect(only.text).toContain(PEER_WORDS);
    expect(only.text).toContain("Ops (another agent)");
  });

  /**
   * TEST_SCENARIO: The boundary is gone — a restart or handover — on a thread
   * longer than one page. Standing in for it means finding the agent's own last
   * post, which sits at the thread's recent end; reading the thread's beginning
   * finds an early post of its own, or none, and hands back no catch-up. The
   * stand-in reads the tail, so the peer's reply survives the handover.
   */
  it("derives a lost boundary from the tail of a long thread", async () => {
    const h = harness([boundSession()]);
    await h.worker.start(SELF, {} as StoredChannelConfig);

    const filler = Array.from({ length: 57 }, (_, i) => ({
      ts: `1.${String(i + 1).padStart(3, "0")}`,
      user: "U555",
      text: `chatter ${i + 1}`,
    }));

    h.gw.setHistory([
      { ts: "1.000", user: "U999", text: OLD_WORDS },
      ...filler,
      footered(SELF, "1.058", "looking now"),
      footered(PEER, "1.059", PEER_WORDS),
      { ts: "1.061", user: "U999", text: "<@U-BOT> Helper so are we clear" },
    ]);
    await h.gw.fireMention(mention("1.061", "<@U-BOT> Helper so are we clear"));

    expect(h.prompts).toHaveLength(1);
    const only = h.prompts[0]!;
    expect(only.resumed).toBe(true);
    expect(only.text).toContain(PEER_WORDS);
    expect(only.text).toContain("Ops (another agent)");
    expect(only.text).not.toContain("chatter 1 ");
  });
});
