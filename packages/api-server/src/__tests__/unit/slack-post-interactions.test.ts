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
import { noArtifacts } from "../helpers/artifact-links.js";

/**
 * TEST_OVERVIEW: An Agent's Slack post can hold buttons and fields. An
 * interaction with one behaves as a message in the post's thread, addressed
 * to the Agent that made the post: a click names the button, its value and
 * the values of the post's fields, and a changed field names its new value.
 * The Agent comes from the identifier the platform wrote on the element, so
 * only an interaction with an Agent's own choice button or field is
 * delivered. The platform never changes the post; the Agent does that with
 * an edit. So the person who clicked is told privately that the click was
 * passed on, and the same click is not passed on twice within a minute.
 */

const OWNER = "kc|owner-1";
const HOME = "C-HOME";
const ASKER = "agent-asker";
const WEB_SESSION = "web-1";
const POST_TS = "1700000000.000100";

const field = (name: string) => `agent-field:${ASKER}:${name}`;

const CHOICES = {
  type: "actions",
  elements: [
    {
      type: "button",
      text: { type: "plain_text", text: "Approve" },
      action_id: `agent-button:${ASKER}:0`,
      value: "approve",
    },
  ],
};

configureLogger({ level: "error", write: () => {} });

const tick = () => new Promise((r) => setTimeout(r, 0));

async function settled(done: () => boolean): Promise<boolean> {
  for (let i = 0; i < 200 && !done(); i++) await tick();
  return done();
}

async function quiet(): Promise<void> {
  for (let i = 0; i < 20; i++) await tick();
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
  let clicks = 0;

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
    fieldChangeQuietMs: 0,
  });

  const notices = () =>
    gw
      .readOutbound()
      .filter((record) => record.kind === "ephemeral")
      .map((record) => record.text);

  return {
    gw,
    worker,
    prompts,
    notices,
    async interact(
      over: {
        actionId?: string;
        ephemeral?: boolean;
        postTs?: string;
        value?: string;
        userId?: string;
        fields?: Record<string, unknown>;
        changed?: { type: string; state: Record<string, unknown> };
      } = {},
    ) {
      clicks += 1;
      await gw.fireMessageAction({
        actionId: over.actionId ?? `agent-button:${ASKER}:0`,
        value: over.changed ? "" : (over.value ?? "approve"),
        ephemeral: over.ephemeral ?? false,
        userId: over.userId ?? "U-PERSON",
        channelId: HOME,
        post: {
          ts: over.postTs ?? POST_TS,
          clickedAt: `17000000${60 + clicks}.000000`,
          elementType: over.changed?.type ?? "button",
          ...(over.changed
            ? { changed: over.changed.state }
            : { label: "Approve" }),
          ...(over.fields ? { fields: over.fields } : {}),
        },
      });
    },
  };
}

describe("an interaction with an element of an agent's post", () => {
  /**
   * TEST_SCENARIO: The Agent posted "Approve" with a plain post. A person
   * clicks it. The click reaches the Agent as an addressed turn in the post's
   * thread, and the prompt names the button and the value the Agent set on
   * it. A plain post is one-way, so the turn opens a new Session. The person
   * gets a private notice that names the Agent, and the post is not changed:
   * what it shows next is the Agent's to decide.
   */
  it("starts a turn, tells the person, and leaves the post as it is", async () => {
    const h = harness();
    await h.worker.start(ASKER);

    await h.interact();

    expect(await settled(() => h.prompts.length === 1)).toBe(true);
    expect(h.prompts[0]).toMatchObject({ agent: ASKER, resumed: null });
    expect(h.prompts[0]!.text).toContain('The button "Approve"');
    expect(h.prompts[0]!.text).toContain('Its value is "approve"');
    expect(h.prompts[0]!.text).toContain(POST_TS);
    expect(await settled(() => h.notices().length === 1)).toBe(true);
    expect(h.notices()).toEqual([
      'Your click on "Approve" was passed to Asker.',
    ]);
    expect(h.gw.readUpdates()).toEqual([]);
  });

  /**
   * TEST_SCENARIO: A person who sees no change clicks again. The same click
   * by the same person is not passed on a second time, and the person is
   * told so. Another person's click on the same button is a different
   * answer and is passed on, so a vote of several people works.
   */
  it("passes the same click on once, and another person's click too", async () => {
    const h = harness();
    await h.worker.start(ASKER);

    await h.interact();
    expect(await settled(() => h.prompts.length === 1)).toBe(true);
    await h.interact();
    await quiet();

    expect(h.prompts).toHaveLength(1);
    expect(h.notices().at(-1)).toBe(
      'Your click on "Approve" was already passed on. Wait for the answer.',
    );

    await h.interact({ userId: "U-OTHER" });

    expect(await settled(() => h.prompts.length === 2)).toBe(true);
  });

  /**
   * TEST_SCENARIO: A form is an input block and a button. Slack sends the
   * state of the post's fields with the click, and the Agent reads them
   * under the names it chose. The person corrects a field and submits again
   * within the minute: the values differ, so it is a new answer and is
   * passed on.
   */
  it("hands the post's field values over with a click, and a changed form again", async () => {
    const h = harness();
    await h.worker.start(ASKER);
    const filled = (reason: string) => ({
      b1: { [field("reason")]: { type: "plain_text_input", value: reason } },
    });

    await h.interact({ fields: filled("typo") });
    expect(await settled(() => h.prompts.length === 1)).toBe(true);
    expect(h.prompts[0]!.text).toContain(
      'The post\'s fields hold {"reason":"typo"}.',
    );

    await h.interact({ fields: filled("fixed") });

    expect(await settled(() => h.prompts.length === 2)).toBe(true);
    expect(h.prompts[1]!.text).toContain('{"reason":"fixed"}');
  });

  /**
   * TEST_SCENARIO: A select outside an input block sends its change at once.
   * The change reaches the Agent with the field's name and its new value.
   * Slack shows the new value in the post itself, so the person gets no
   * notice, and a change is never held back as a repeat.
   */
  it("delivers a changed field with its name and value", async () => {
    const h = harness();
    await h.worker.start(ASKER);

    await h.interact({
      actionId: field("region"),
      changed: {
        type: "static_select",
        state: { selected_option: { value: "eu-west" } },
      },
    });

    expect(await settled(() => h.prompts.length === 1)).toBe(true);
    expect(h.prompts[0]!.text).toContain(
      '[field change] The "region" field (static_select)',
    );
    expect(h.prompts[0]!.text).toContain('changed to "eu-west"');
    await quiet();
    expect(h.notices()).toEqual([]);
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
      card: { blocks: [CHOICES], text: "Approve" },
    });
    if ("error" in started) throw new Error(started.error);

    await h.interact({ postTs: started.threadTs });

    expect(await settled(() => h.prompts.length === 1)).toBe(true);
    expect(h.prompts[0]).toMatchObject({ agent: ASKER, resumed: WEB_SESSION });
    expect(h.prompts[0]!.text).toContain("Approve");
  });

  /**
   * TEST_SCENARIO: Only the platform writes the identifier that names an
   * Agent, and only on a choice button or a field. A click on a link button,
   * an interaction with a private message, and a click with the private
   * menu's identifier on a public post must start no turn.
   */
  it("delivers nothing for a link button, a private message or a foreign id", async () => {
    const h = harness();
    await h.worker.start(ASKER);

    await h.interact({ actionId: `agent-link:${ASKER}:0` });
    await h.interact({ ephemeral: true });
    await h.interact({ actionId: "command-menu:0", value: "unbind asker" });

    await quiet();
    expect(h.prompts).toEqual([]);
    expect(h.notices()).toEqual([]);
  });

  /**
   * TEST_SCENARIO: An Agent can post into a channel it reaches but is not
   * connected to. A click there cannot become a turn, so the person who
   * clicked is told, privately, and the Agent is not started. Nothing was
   * passed on, so the same click is not held back as a repeat.
   */
  it("tells the person when the agent is not connected to the conversation", async () => {
    const h = harness();
    await h.worker.start(ASKER);

    await h.interact({ actionId: "agent-button:agent-gone:0" });
    await h.interact({ actionId: "agent-button:agent-gone:0" });

    await quiet();
    expect(h.prompts).toEqual([]);
    expect(h.notices()).toEqual([
      expect.stringContaining("did not get what you did here"),
      expect.stringContaining("did not get what you did here"),
    ]);
  });
});
