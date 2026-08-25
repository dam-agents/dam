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
 * what a peer agent posted there while it was away. A thread maps to one
 * resumable session per agent, so only an agent's first turn in a thread opens
 * a fresh session and receives the thread's history. These tests pin what the
 * later, resumed turns are handed: the messages that arrived since that agent's
 * own last turn, attributed, and nothing it has already seen.
 */
function harness(existingSessions: AcpSessionInfo[] = []) {
  const gw = createFakeSlackGateway();
  const prompts: Array<{ resumed: boolean; text: string }> = [];
  const created: AcpSessionInfo[] = [];

  const acp: AcpClient = {
    listSessions: async () => [...existingSessions, ...created],
    sendPrompt: async (prompt: string | ContentBlock[], opts) => {
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

  const worker = createSlackWorker(
    () => acp,
    () => gw,
    () => agents,
    { resolve: async () => null } as never,
    { authUrl: "http://kc", clientId: "c" } as never,
    createMemoryTtlStore(600_000),
    async () => OWNER,
    {
      resolveSlackBindings: async () => [
        { instanceName: SELF, owner: OWNER, ambient: false, isDefault: true },
        { instanceName: PEER, owner: OWNER, ambient: false, isDefault: false },
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

  return { gw, prompts, worker };
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

describe("what a later mention turn sees of a peer agent's thread post", () => {
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
});
