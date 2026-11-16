import { createMemoryTtlStore } from "../../core/ttl-store.js";
import { describe, it, expect } from "vitest";
import type { AgentsService } from "api-server-api";
import type { ContentBlock } from "@agentclientprotocol/sdk";
import {
  createSlackWorker,
  type SlackWorker,
} from "../../modules/channels/infrastructure/slack.js";
import { createFakeSlackGateway } from "../../modules/channels/infrastructure/fake-slack-gateway.js";
import { createMemorySlackOwnedThreads } from "../../modules/channels/infrastructure/slack-owned-threads-repository.js";
import { stubTurnAttendance } from "../helpers/turn-attendance.js";
import { stubWorkspaceFiles } from "../helpers/workspace-files.js";
import type {
  AcpClient,
  AcpSessionInfo,
  SendPromptOpts,
} from "../../core/acp-client.js";
import { configureLogger } from "../../core/logger.js";
import { agentContextBlock } from "../../modules/channels/infrastructure/agent-footer.js";
import { noArtifacts } from "../helpers/artifact-links.js";

/**
 * TEST_OVERVIEW: A button without a url in an Agent's Slack post sends a
 * choice back. A click on it behaves as a message in the post's thread,
 * addressed to the Agent that made the post: it starts a turn that names the
 * button and its value, under the thread routing a typed message follows.
 * The Agent comes from the identifier the platform wrote on the button, so
 * only a click on a choice button of an Agent's own post is delivered. A
 * post takes one answer: after it the post names who chose what.
 */

const OWNER = "kc|owner-1";
const HOME = "C-HOME";
const ASKER = "agent-asker";
const WEB_SESSION = "web-1";
const POST_TS = "1700000000.000100";
const CLICKED_AT = "1700000060.000000";

const button = (label: string, id: string, url?: string) => ({
  type: "button",
  text: { type: "plain_text", text: label },
  action_id: id,
  ...(url ? { url } : { value: label.toLowerCase() }),
});

const CHOICES = {
  type: "actions",
  elements: [
    button("Approve", `agent-button:${ASKER}:0`),
    button("Reject", `agent-button:${ASKER}:1`),
    button("Open the PR", `agent-link:${ASKER}:2`, "https://example.com/pr/1"),
  ],
};

const FOOTER = agentContextBlock({
  uiBaseUrl: "http://ui",
  agentId: ASKER,
  label: "Sent by Asker",
});

configureLogger({ level: "error", write: () => {} });

const tick = () => new Promise((r) => setTimeout(r, 0));

async function settled(done: () => boolean): Promise<boolean> {
  for (let i = 0; i < 200 && !done(); i++) await tick();
  return done();
}

type Prompt = { agent: string; text: string; resumed: string | null };

function textOf(prompt: string | ContentBlock[]): string {
  return typeof prompt === "string" ? prompt : JSON.stringify(prompt);
}

function harness() {
  const gw = createFakeSlackGateway();
  gw.setChannels([{ id: HOME, name: "home", botIsMember: true }]);
  gw.setThreadedHistory([]);
  const prompts: Prompt[] = [];
  const created: AcpSessionInfo[] = [];

  const makeAcp = (agent: string): AcpClient => ({
    steer: async () => "unsupported" as const,
    listSessions: async () => [{ sessionId: WEB_SESSION }, ...created],
    sendPrompt: async (prompt, sendOpts: SendPromptOpts) => {
      const resumed =
        "resumeSessionId" in sendOpts ? sendOpts.resumeSessionId : null;
      if ("platformMeta" in sendOpts && sendOpts.platformMeta)
        created.push({
          sessionId: `slack-${created.length + 1}`,
          platform: sendOpts.platformMeta,
        });
      prompts.push({ agent, text: textOf(prompt), resumed });
      return "answer";
    },
    triggerSession: () => Promise.reject(new Error("unused")),
    turnStatus: async () => "unknown" as const,
  });

  const agents = {
    ensureReady: async () => {},
    get: async (id: string) => (id === ASKER ? { id, name: "Asker" } : null),
  } as unknown as AgentsService;

  const worker: SlackWorker = createSlackWorker({
    makeAcpClient: makeAcp,
    createGateway: () => gw,
    agents: () => agents,
    identityLinks: { resolve: async () => null } as never,
    oauthConfig: { authUrl: "http://kc", clientId: "c" } as never,
    pendingOAuthFlows: createMemoryTtlStore(600_000),
    getInstanceOwner: async () => OWNER,
    ownerDisplayName: async () => null,
    channelRegistry: {
      resolveSlackBindings: async () => [
        { instanceName: ASKER, owner: OWNER, ambient: false, isDefault: true },
      ],
      resolveSlackChannelsByInstance: async () => [{ id: HOME, teamId: "" }],
    } as never,
    unbindSlackChannel: async () => {},
    setSlackChannelAmbient: async () => {},
    setSlackChannelHistory: async () => {},
    agentsFor: () => ({}) as never,
    ignoredApps: {
      list: async () => [],
      ignore: async () => true,
      unignore: async () => true,
    },
    setSlackDefault: async () => true,
    brand: { name: "DAM", short: "dam" },
    isTermsAccepted: async () => true,
    uiBaseUrl: "http://ui",
    linkArtifacts: noArtifacts,
    attendance: stubTurnAttendance(),
    workspaceFiles: stubWorkspaceFiles(),
    listWorkspaces: async () => [],
    emit: () => {},
    ownedThreads: createMemorySlackOwnedThreads(),
  });

  return {
    gw,
    worker,
    prompts,
    async click(
      over: {
        actionId?: string;
        ephemeral?: boolean;
        postTs?: string;
        value?: string;
      } = {},
    ) {
      await gw.fireMessageAction({
        actionId: over.actionId ?? `agent-button:${ASKER}:0`,
        value: over.value ?? "approve",
        ephemeral: over.ephemeral ?? false,
        userId: "U-PERSON",
        channelId: HOME,
        post: {
          ts: over.postTs ?? POST_TS,
          clickedAt: CLICKED_AT,
          label: "Approve",
        },
      });
    },
  };
}

describe("a click on a choice button of an agent's post", () => {
  /**
   * TEST_SCENARIO: The Agent posted "Approve" and "Reject" with a plain post.
   * A person clicks "Approve". The click reaches the Agent as an addressed
   * turn in the post's thread, and the prompt names the button and the value
   * the Agent set on it. A plain post is one-way, so the turn opens a new
   * Session, as a tagged reply under the post does.
   */
  it("starts a turn that names the button and its value", async () => {
    const h = harness();
    await h.worker.start(ASKER);

    await h.click();

    expect(await settled(() => h.prompts.length === 1)).toBe(true);
    expect(h.prompts[0]).toMatchObject({ agent: ASKER, resumed: null });
    expect(h.prompts[0]!.text).toContain('The button "Approve"');
    expect(h.prompts[0]!.text).toContain('Its value is "approve"');
    expect(h.prompts[0]!.text).toContain(POST_TS);
  });

  /**
   * TEST_SCENARIO: A thread started with start_thread is owned by the Session
   * that started it. A click on a button of its opening post goes where a
   * message in that thread goes: back to that Session, with no new Session.
   */
  it("reaches the session that owns the thread", async () => {
    const h = harness();
    await h.worker.start(ASKER);
    const started = await h.worker.startThread(ASKER, {
      sessionId: WEB_SESSION,
      conversationId: HOME,
      text: "Deploy 2.4?",
      card: { blocks: [CHOICES], text: "Approve / Reject" },
    });
    if ("error" in started) throw new Error(started.error);

    await h.click({ postTs: started.threadTs });

    expect(await settled(() => h.prompts.length === 1)).toBe(true);
    expect(h.prompts[0]).toMatchObject({ agent: ASKER, resumed: WEB_SESSION });
    expect(h.prompts[0]!.text).toContain("Approve");
  });

  /**
   * TEST_SCENARIO: Only the platform writes the identifier that names an
   * Agent, and only on a choice button. A click on a link button, a click on
   * a private message, and a click with the private menu's identifier on a
   * public post must start no turn.
   */
  it("delivers nothing for a link button, a private message or a foreign id", async () => {
    const h = harness();
    await h.worker.start(ASKER);

    await h.click({ actionId: `agent-link:${ASKER}:0` });
    await h.click({ ephemeral: true });
    await h.click({ actionId: "command-menu:0", value: "unbind asker" });

    for (let i = 0; i < 20; i++) await tick();
    expect(h.prompts).toEqual([]);
  });

  /**
   * TEST_SCENARIO: A post takes one answer. Once the click is handed to the
   * Agent, the post loses its choice buttons, keeps its link button, and
   * names who chose what above the Agent Footer, which stays the last block.
   * A second person who clicks on a copy still open in their client starts
   * no second turn and is told the post was already answered.
   */
  it("shows the choice on the post and takes no second answer", async () => {
    const h = harness();
    await h.worker.start(ASKER);
    const question = { type: "markdown", text: "Deploy 2.4?" };
    h.gw.setMessage(HOME, {
      ts: POST_TS,
      text: "Deploy 2.4?\n\nApprove / Reject",
      user: "U-BOT",
      blocks: [question, CHOICES, FOOTER],
    });

    await h.click();

    expect(await settled(() => h.gw.readUpdates().length === 1)).toBe(true);
    expect(h.gw.readUpdates()[0]).toMatchObject({
      channel: HOME,
      ts: POST_TS,
      text: "Deploy 2.4?\n\nApprove / Reject\n<@U-PERSON> chose: Approve",
      blocks: [
        question,
        { type: "actions", elements: [CHOICES.elements[2]] },
        {
          type: "context",
          elements: [{ type: "mrkdwn", text: "<@U-PERSON> chose: Approve" }],
        },
        FOOTER,
      ],
    });
    expect(await settled(() => h.prompts.length === 1)).toBe(true);

    await h.click({ actionId: `agent-button:${ASKER}:1`, value: "reject" });

    for (let i = 0; i < 20; i++) await tick();
    expect(h.prompts).toHaveLength(1);
    expect(h.gw.readUpdates()).toHaveLength(1);
    expect(h.gw.readOutbound().at(-1)).toMatchObject({
      channel: HOME,
      text: expect.stringContaining("already answered"),
    });
  });

  /**
   * TEST_SCENARIO: An Agent can post into a channel it reaches but is not
   * connected to. A click there cannot become a turn, so the person who
   * clicked is told, privately, and the Agent is not started.
   */
  it("tells the person when the agent is not connected to the conversation", async () => {
    const h = harness();
    await h.worker.start(ASKER);

    await h.click({ actionId: "agent-button:agent-gone:0" });

    for (let i = 0; i < 20; i++) await tick();
    expect(h.prompts).toEqual([]);
    expect(h.gw.readOutbound()).toMatchObject([
      {
        channel: HOME,
        text: expect.stringContaining("your click did not reach it"),
      },
    ]);
  });
});
