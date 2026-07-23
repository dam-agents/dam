import { describe, it, expect } from "vitest";
import type { AgentsService } from "api-server-api";
import type { ContentBlock } from "@agentclientprotocol/sdk/dist/schema/types.gen.js";
import { createSlackWorker } from "../../modules/channels/infrastructure/slack.js";
import { createFakeSlackGateway } from "../../modules/channels/infrastructure/fake-slack-gateway.js";
import { agentContextBlock } from "../../modules/channels/infrastructure/agent-footer.js";
import type { AcpClient } from "../../core/acp-client.js";
import { configureLogger } from "../../core/logger.js";
import type { StoredChannelConfig } from "../../modules/channels/stored-channel.js";

configureLogger({ level: "error", write: () => {} });

const OWNER = "kc|owner-1";

// A shared binding: a mention relays straight to the main pod, and — because
// listSessions returns [] — always mints a fresh session, so the injected
// thread history runs through the attribution relabeling.
function harness() {
  const gw = createFakeSlackGateway();
  const prompts: Array<string | ContentBlock[]> = [];
  const acp: AcpClient = {
    listSessions: async () => [],
    sendPrompt: async (prompt) => {
      prompts.push(prompt);
      return "the answer";
    },
    triggerSession: () => Promise.reject(new Error("unused")),
  };
  const agents = {
    ensureReady: async () => {},
    isAllowedUser: async () => false,
  } as unknown as AgentsService;

  const worker = createSlackWorker(
    () => acp,
    () => gw,
    () => agents,
    { resolve: async () => null } as never,
    { authUrl: "http://kc", clientId: "c" } as never,
    new Map(),
    async () => OWNER,
    {
      resolveSlackBinding: async () => ({
        instanceName: "agent-1",
        owner: OWNER,
        mode: "shared" as const,
      }),
      resolveSlackChannelByInstance: async () => "C1",
    } as never,
    async () => {},
    async () => {},
    { name: "DAM", short: "dam" },
    async () => true,
    "http://ui",
    () => acp,
    () => {},
  );

  return { gw, prompts, worker };
}

describe("slack cross-agent history attribution", () => {
  it("labels self, other agents, and humans in injected history", async () => {
    const h = harness();
    // Every agent posts under the same install-wide bot user id (U-BOT); the
    // footer is what distinguishes them.
    h.gw.setHistory([
      {
        ts: "0.1",
        user: "U-BOT",
        text: "already looking into it",
        blocks: [
          agentContextBlock({
            uiBaseUrl: "http://ui",
            agentId: "agent-1",
            agentName: "Helper",
          }),
        ],
      },
      {
        ts: "0.2",
        user: "U-BOT",
        text: "I ran the deploy",
        blocks: [
          agentContextBlock({
            uiBaseUrl: "http://ui",
            agentId: "agent-99",
            agentName: "Ops",
          }),
        ],
      },
      { ts: "0.3", user: "U999", text: "thanks all" },
    ]);

    await h.worker.start("agent-1", {} as StoredChannelConfig);
    await h.gw.fireMention({
      user: "U999",
      channel: "C1",
      ts: "1.1",
      text: "hey agent",
    });

    expect(h.prompts).toHaveLength(1);
    const prompt = String(h.prompts[0]);
    // The reading agent's own past post — resolved server-side, not by name.
    expect(prompt).toContain("you (this agent): already looking into it");
    // A different agent, named from its footer.
    expect(prompt).toContain("Ops (another agent): I ran the deploy");
    // A human keeps their Slack id.
    expect(prompt).toContain("U999: thanks all");
    // The legend that explains the prefixes is present…
    expect(prompt).toContain("you (this agent)");
    expect(prompt).toContain("another agent");
    // …and no raw agent id leaks into the prompt.
    expect(prompt).not.toContain("agent-1");
    expect(prompt).not.toContain("agent-99");
  });

  it("omits the legend when history has no agent-authored messages", async () => {
    const h = harness();
    h.gw.setHistory([{ ts: "0.1", user: "U999", text: "just humans here" }]);

    await h.worker.start("agent-1", {} as StoredChannelConfig);
    await h.gw.fireMention({
      user: "U999",
      channel: "C1",
      ts: "1.1",
      text: "hey agent",
    });

    const prompt = String(h.prompts[0]);
    expect(prompt).toContain("U999: just humans here");
    expect(prompt).not.toContain("(this agent)");
    expect(prompt).not.toContain("(another agent)");
  });
});
