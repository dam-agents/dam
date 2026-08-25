import { createMemoryTtlStore } from "../../core/ttl-store.js";
import { describe, it, expect } from "vitest";
import type { AgentsService } from "api-server-api";
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

const SELF = "agent-1";
const PEER = "agent-99";

/**
 * TEST_OVERVIEW: What an agent taking a second mention in a Slack thread can
 * see of what a *peer* agent posted there while it was away. Injected history
 * is the only channel that carries a peer's words into a mention turn, and it
 * is built only when the turn opens a fresh session — so these tests pin which
 * of the two prompt shapes each turn gets, and what survives into it.
 */
function harness(existingSessions: () => AcpSessionInfo[]) {
  const gw = createFakeSlackGateway();
  const prompts: Array<{ resumed: boolean; text: string }> = [];
  const created: AcpSessionInfo[] = [];

  const acp: AcpClient = {
    listSessions: async () => [...existingSessions(), ...created],
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

const PEER_WORDS = "I already rolled the deploy back";

describe("what a mention turn sees of a peer agent's thread post", () => {
  /**
   * TEST_SCENARIO: The reported sequence. A human opens a thread and mentions
   * agent A, which answers. The human then mentions agent B in the same thread,
   * and B answers. The human comes back to A. A's second turn resumes the
   * session it opened on its first, so it is handed the new message with no
   * injected history — and B's post, which arrived while A was away, is in
   * neither. A answers a thread it cannot see the middle of.
   */
  it("does not show a peer's post to an agent resuming its own thread session", async () => {
    const h = harness(() => []);
    await h.worker.start(SELF, {} as StoredChannelConfig);

    h.gw.setHistory([{ ts: "1.0", user: "U999", text: "deploy looks broken" }]);
    await h.gw.fireMention({
      user: "U999",
      channel: CHANNEL,
      ts: THREAD_TS,
      text: "<@U-BOT> Helper can you look",
    });

    expect(h.prompts).toHaveLength(1);
    expect(h.prompts[0]!.resumed).toBe(false);

    h.gw.setHistory([
      { ts: "1.0", user: "U999", text: "deploy looks broken" },
      footered(SELF, "1.1", "looking now"),
      { ts: "1.2", user: "U999", text: "<@U-BOT> Ops what do you think" },
      footered(PEER, "1.3", PEER_WORDS),
    ]);

    await h.gw.fireMention({
      user: "U999",
      channel: CHANNEL,
      ts: "1.4",
      threadTs: THREAD_TS,
      text: "<@U-BOT> Helper so are we clear now",
    });

    expect(h.prompts).toHaveLength(2);
    const second = h.prompts[1]!;

    expect(second.resumed).toBe(true);
    expect(second.text).toContain("so are we clear now");

    expect(second.text).not.toContain(PEER_WORDS);
    expect(second.text).not.toContain("another agent");
    expect(second.text).not.toContain("<context>");

    expect(second.text).toContain("You are not the only agent here");
    expect(second.text).toContain('"Ops"');
  });

  /**
   * TEST_SCENARIO: The same thread state reaching an agent that has no session
   * for it yet — agent B's first turn in the sequence above. Here history is
   * injected, so the peer's words arrive attributed. This is the contrast that
   * localizes the gap to session reuse rather than to attribution: the labelling
   * works, it is just never built on a resumed turn.
   */
  it("shows the peer's post, attributed, to an agent opening a fresh session", async () => {
    const h = harness(() => []);
    await h.worker.start(SELF, {} as StoredChannelConfig);

    h.gw.setHistory([
      { ts: "1.0", user: "U999", text: "deploy looks broken" },
      footered(PEER, "1.3", PEER_WORDS),
    ]);

    await h.gw.fireMention({
      user: "U999",
      channel: CHANNEL,
      ts: "1.4",
      threadTs: THREAD_TS,
      text: "<@U-BOT> Helper so are we clear now",
    });

    expect(h.prompts).toHaveLength(1);
    const only = h.prompts[0]!;

    expect(only.resumed).toBe(false);
    expect(only.text).toContain("<context>");
    expect(only.text).toContain(`Ops (another agent)`);
    expect(only.text).toContain(PEER_WORDS);
  });
});
