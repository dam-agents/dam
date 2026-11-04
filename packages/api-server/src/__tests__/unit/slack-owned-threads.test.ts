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
import type { SlackMessage } from "../../modules/channels/infrastructure/slack-gateway.js";
import { agentContextBlock } from "../../modules/channels/infrastructure/agent-footer.js";

/**
 * TEST_OVERVIEW: A Session owns the Slack threads it starts. A reply in such a
 * thread, from a person or another agent, tagging the agent or not, becomes a
 * turn of that Session — no new Session, and framed as channel content, not as
 * the operator. A plain post stays one-way, a thread the Session left is not
 * followed, two owned threads never prompt one Session at once, and a thread
 * whose Session is gone falls back to the road it would have taken unowned.
 */

const OWNER = "kc|owner-1";
const HOME = "C-HOME";
const OTHER = "C-OTHER";
const ASKER = "agent-asker";
const PEER = "agent-peer";
const WEB_SESSION = "web-1";

configureLogger({ level: "error", write: () => {} });

const tick = () => new Promise((r) => setTimeout(r, 0));

function after(threadTs: string, n: number): string {
  return `${Number(threadTs.split(".")[0]) + n}.000000`;
}

async function settled(done: () => boolean): Promise<boolean> {
  for (let i = 0; i < 200 && !done(); i++) await tick();
  return done();
}

type Prompt = {
  agent: string;
  text: string;
  resumed: string | null;
  surface: string | undefined;
};

function textOf(prompt: string | ContentBlock[]): string {
  return typeof prompt === "string" ? prompt : JSON.stringify(prompt);
}

function harness(
  opts: {
    peer?: boolean;
    ambient?: boolean;
    sessions?: string[];
    onPrompt?: (prompt: Prompt) => Promise<void> | void;
  } = {},
) {
  const gw = createFakeSlackGateway();
  gw.setChannels([
    { id: HOME, name: "home", botIsMember: true },
    { id: OTHER, name: "other", botIsMember: true },
  ]);
  gw.setThreadedHistory([]);
  const ownedThreads = createMemorySlackOwnedThreads();
  const prompts: Prompt[] = [];
  const created: AcpSessionInfo[] = [];
  const sessions = new Set(opts.sessions ?? [WEB_SESSION]);

  const makeAcp = (agent: string): AcpClient => ({
    steer: async () => "unsupported" as const,
    listSessions: async () => [
      ...[...sessions].map((sessionId) => ({ sessionId })),
      ...created,
    ],
    sendPrompt: async (prompt, sendOpts: SendPromptOpts) => {
      const resumed =
        "resumeSessionId" in sendOpts ? sendOpts.resumeSessionId : null;
      if ("platformMeta" in sendOpts && sendOpts.platformMeta)
        created.push({
          sessionId: `slack-${created.length + 1}`,
          platform: sendOpts.platformMeta,
        });
      const record = {
        agent,
        text: textOf(prompt),
        resumed,
        surface: sendOpts.surface,
      };
      prompts.push(record);
      await opts.onPrompt?.(record);
      return "answer";
    },
    triggerSession: () => Promise.reject(new Error("unused")),
    turnStatus: async () => "unknown" as const,
  });

  const names: Record<string, string> = { [ASKER]: "Asker", [PEER]: "Peer" };
  const agents = {
    ensureReady: async () => {},
    get: async (id: string) => (names[id] ? { id, name: names[id] } : null),
  } as unknown as AgentsService;

  const bindings = [
    {
      instanceName: ASKER,
      owner: OWNER,
      ambient: opts.ambient ?? false,
      isDefault: true,
    },
    ...(opts.peer
      ? [{ instanceName: PEER, owner: OWNER, ambient: false, isDefault: false }]
      : []),
  ];

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
      resolveSlackBindings: async () => bindings,
      resolveSlackChannelsByInstance: async () => [
        { id: HOME, teamId: "" },
        { id: OTHER, teamId: "" },
      ],
    } as never,
    unbindSlackChannel: async () => {},
    setSlackChannelAmbient: async () => {},
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
    attendance: stubTurnAttendance(),
    workspaceFiles: stubWorkspaceFiles(),
    listWorkspaces: async () => [],
    emit: () => {},
    ownedThreads,
  });

  const history: SlackMessage[] = [];

  return {
    gw,
    worker,
    prompts,
    created,
    sessions,
    ownedThreads,
    async start() {
      await worker.start(ASKER);
    },
    async startThread(text = "Which region do we deploy to?", sessionId = WEB_SESSION) {
      await worker.start(ASKER);
      const started = await worker.startThread(ASKER, {
        sessionId,
        conversationId: OTHER,
        text,
      });
      if ("error" in started) throw new Error(started.error);
      history.push({ ts: started.threadTs, text, user: "U-BOT" });
      gw.setThreadedHistory([...history]);
      return started;
    },
    async replyInThread(
      threadTs: string,
      ts: string,
      text: string,
      sender?: Parameters<typeof gw.fireMessage>[0]["sender"],
    ) {
      history.push(
        sender?.kind === "agent"
          ? {
              ts,
              text,
              threadTs,
              user: "U-BOT",
              blocks: [
                agentContextBlock({
                  uiBaseUrl: "http://ui",
                  agentId: sender.agentId,
                  label: "Sent by an agent",
                }),
              ],
            }
          : { ts, text, threadTs, user: "U-PERSON" },
      );
      gw.setThreadedHistory([...history]);
      await gw.fireMessage({
        user: "U-PERSON",
        channel: OTHER,
        ts,
        threadTs,
        text,
        channelType: "channel",
        ...(sender ? { sender } : {}),
      });
    },
    async mentionInThread(threadTs: string, ts: string, text: string) {
      history.push({ ts, text, threadTs, user: "U-PERSON" });
      gw.setThreadedHistory([...history]);
      await gw.fireMention({
        user: "U-PERSON",
        channel: OTHER,
        ts,
        threadTs,
        text,
      });
    },
  };
}

describe("a reply under a thread a session started", () => {
  /**
   * TEST_SCENARIO: AC-1 and AC-2. The owner's web chat session asks in another
   * channel; a person replies under the post without tagging the agent. The
   * reply reaches the web chat session that asked, framed as channel content,
   * and no Slack session is created for the thread.
   */
  it("becomes a turn of the session that asked, with no new session", async () => {
    const h = harness();
    const started = await h.startThread();
    expect(started.conversationId).toBe(OTHER);

    await h.replyInThread(started.threadTs, after(started.threadTs, 1), "eu-west, please");

    expect(await settled(() => h.prompts.length === 1)).toBe(true);
    const [turn] = h.prompts;
    expect(turn).toMatchObject({
      agent: ASKER,
      resumed: WEB_SESSION,
      surface: "message",
    });
    expect(turn!.text).toContain("eu-west, please");
    expect(turn!.text).toContain(`chatId="${OTHER}"`);
    expect(turn!.text).toContain(`threadTs="${started.threadTs}"`);
    expect(turn!.text).toContain(
      "it is not a message from the person you work with in this session",
    );
    expect(h.created).toEqual([]);
  });

  // TEST_SCENARIO: a reply that tags the agent goes to the owning session too, never to a fresh thread session as well.
  it("takes a tagged reply to the owning session alone", async () => {
    const h = harness();
    const started = await h.startThread();

    await h.mentionInThread(
      started.threadTs,
      after(started.threadTs, 2),
      "<@U-BOT> eu-west",
    );

    expect(await settled(() => h.prompts.length === 1)).toBe(true);
    for (let i = 0; i < 20; i++) await tick();
    expect(h.prompts).toHaveLength(1);
    expect(h.prompts[0]!.resumed).toBe(WEB_SESSION);
    expect(h.created).toEqual([]);
  });

  /**
   * TEST_SCENARIO: AC-3. Another agent answers in the thread. Its post reaches
   * the asking session; the asking agent's own posts in the thread do not.
   */
  it("brings another agent's answer back, and never the agent's own post", async () => {
    const h = harness({ peer: true });
    const started = await h.startThread();

    await h.replyInThread(started.threadTs, after(started.threadTs, 3), "my own note", {
      kind: "agent",
      agentId: ASKER,
      ambientRound: false,
    });
    await h.replyInThread(started.threadTs, after(started.threadTs, 4), "staging is free", {
      kind: "agent",
      agentId: PEER,
      ambientRound: false,
    });

    expect(await settled(() => h.prompts.length === 1)).toBe(true);
    for (let i = 0; i < 20; i++) await tick();
    expect(h.prompts).toHaveLength(1);
    expect(h.prompts[0]!.text).toContain("staging is free");
    expect(h.prompts[0]!.text).toContain("Peer (another agent)");
    expect(h.prompts[0]!.text).not.toContain("my own note");
  });

  /**
   * TEST_SCENARIO: the asking agent tags a peer in its thread. The peer still
   * gets the mention as its own turn — that is how one agent asks another —
   * while the asker's session is not woken by its own question.
   */
  it("still lets a peer tagged in the thread answer", async () => {
    const h = harness({ peer: true });
    const started = await h.startThread();

    await h.gw.fireMention({
      user: "U-PERSON",
      channel: OTHER,
      ts: after(started.threadTs, 5),
      threadTs: started.threadTs,
      text: "<@U-BOT> Peer what do you think?",
    });

    expect(await settled(() => h.prompts.some((p) => p.agent === PEER))).toBe(
      true,
    );
    expect(await settled(() => h.prompts.some((p) => p.agent === ASKER))).toBe(
      true,
    );
    const peerTurn = h.prompts.find((p) => p.agent === PEER)!;
    expect(peerTurn.resumed).toBeNull();
    const askerTurn = h.prompts.find((p) => p.agent === ASKER)!;
    expect(askerTurn.resumed).toBe(WEB_SESSION);
  });

  /**
   * TEST_SCENARIO: AC-4. A plain post is an announcement: a tagged reply under
   * it opens a Slack session of its own, as before, and the session that
   * posted gets no turn.
   */
  it("leaves a plain post one-way", async () => {
    const h = harness();
    await h.start();
    const posted = await h.worker.postMessage(ASKER, "Release is out", {
      conversationId: OTHER,
    });
    if ("error" in posted) throw new Error(posted.error);

    await h.mentionInThread(posted.ts!, after(posted.ts!, 6), "<@U-BOT> nice, thanks");

    expect(await settled(() => h.prompts.length === 1)).toBe(true);
    expect(h.prompts[0]!.resumed).toBeNull();
    expect(h.created).toHaveLength(1);
  });

  /**
   * TEST_SCENARIO: AC-5. A session that started two threads lists both, with
   * each thread's reply count, and says a reply is waiting where one arrived
   * after the last message the session was handed.
   */
  it("lists the threads a session follows, with their replies", async () => {
    const h = harness();
    const first = await h.startThread("Which region?");
    const second = await h.startThread("Which owner?");
    await h.startThread("Another session asks", "web-2");

    await h.replyInThread(first.threadTs, after(first.threadTs, 7), "eu-west");
    expect(await settled(() => h.prompts.length === 1)).toBe(true);
    await settled(() => false);

    const listed = await h.worker.listThreads(ASKER, WEB_SESSION);
    if ("error" in listed) throw new Error(listed.error);
    expect(listed.threads).toHaveLength(2);
    const byTs = new Map(listed.threads.map((t) => [t.threadTs, t]));
    expect(byTs.get(first.threadTs)).toMatchObject({
      conversationId: OTHER,
      firstLine: "Which region?",
      replies: 1,
      replyWaiting: false,
    });
    expect(byTs.get(second.threadTs)).toMatchObject({
      firstLine: "Which owner?",
      replies: 0,
      replyWaiting: false,
    });
  });

  /**
   * TEST_SCENARIO: AC-6. After the session leaves the thread, an untagged
   * reply there wakes nobody.
   */
  it("stops following a thread the session left", async () => {
    const h = harness();
    const started = await h.startThread();

    expect(
      await h.worker.leaveThread(ASKER, {
        sessionId: WEB_SESSION,
        conversationId: OTHER,
        threadTs: started.threadTs,
      }),
    ).toEqual({ ok: true });
    await h.replyInThread(started.threadTs, after(started.threadTs, 8), "eu-west");

    for (let i = 0; i < 40; i++) await tick();
    expect(h.prompts).toEqual([]);
    expect(
      await h.worker.leaveThread(ASKER, {
        sessionId: WEB_SESSION,
        conversationId: OTHER,
        threadTs: started.threadTs,
      }),
    ).toMatchObject({ error: expect.stringContaining("does not follow") });
  });

  // TEST_SCENARIO: only the session that owns a thread can let it go.
  it("refuses to leave a thread another session owns", async () => {
    const h = harness();
    const started = await h.startThread();

    expect(
      await h.worker.leaveThread(ASKER, {
        sessionId: "web-2",
        conversationId: OTHER,
        threadTs: started.threadTs,
      }),
    ).toMatchObject({ error: expect.any(String) });
    expect(await h.ownedThreads.find(OTHER, started.threadTs)).not.toBeNull();
  });

  /**
   * TEST_SCENARIO: two owned threads answered at the same moment wait in one
   * queue, so the session gets one prompt at a time, never two at once.
   */
  it("prompts one session one turn at a time across its threads", async () => {
    let running = 0;
    let overlapped = false;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const h = harness({
      onPrompt: async () => {
        running += 1;
        if (running > 1) overlapped = true;
        if (h.prompts.length === 1) await gate;
        running -= 1;
      },
    });
    const first = await h.startThread("Which region?");
    const second = await h.startThread("Which owner?");

    await h.replyInThread(first.threadTs, after(first.threadTs, 9), "eu-west");
    expect(await settled(() => h.prompts.length === 1)).toBe(true);
    await h.replyInThread(second.threadTs, after(second.threadTs, 10), "team blue");
    for (let i = 0; i < 20; i++) await tick();
    expect(h.prompts).toHaveLength(1);

    release();
    expect(await settled(() => h.prompts.length === 2)).toBe(true);
    expect(overlapped).toBe(false);
    expect(h.prompts[1]!.text).toContain("team blue");
    expect(h.prompts[1]!.resumed).toBe(WEB_SESSION);
  });

  /**
   * TEST_SCENARIO: a reply that arrived while the agent was asleep or its turn
   * was lost is caught up: the next turn shows what came after the last
   * message the session was handed, so nothing in the thread is lost.
   */
  it("shows the replies the session missed since its last turn", async () => {
    const h = harness();
    const started = await h.startThread();
    await h.replyInThread(started.threadTs, after(started.threadTs, 11), "eu-west");
    expect(await settled(() => h.prompts.length === 1)).toBe(true);
    await settled(() => false);

    h.gw.setThreadedHistory([
      {
        ts: started.threadTs,
        text: "Which region do we deploy to?",
        user: "U-BOT",
      },
      {
        ts: after(started.threadTs, 11),
        text: "eu-west",
        threadTs: started.threadTs,
        user: "U-PERSON",
      },
      {
        ts: after(started.threadTs, 12),
        text: "actually us-east",
        threadTs: started.threadTs,
        user: "U-PERSON",
      },
      {
        ts: after(started.threadTs, 13),
        text: "final: us-east",
        threadTs: started.threadTs,
        user: "U-PERSON",
      },
    ]);
    await h.gw.fireMessage({
      user: "U-PERSON",
      channel: OTHER,
      ts: after(started.threadTs, 13),
      threadTs: started.threadTs,
      text: "final: us-east",
      channelType: "channel",
    });

    expect(await settled(() => h.prompts.length === 2)).toBe(true);
    const second = h.prompts[1]!.text;
    expect(second).toContain("actually us-east");
    expect(second).toContain("final: us-east");
    expect(second.split("eu-west").length - 1).toBe(0);
  });

  /**
   * TEST_SCENARIO: the session that started the thread was deleted. The
   * thread is released and the reply takes the road an unowned reply takes:
   * a tagged one opens a Slack session of its own.
   */
  it("hands a reply on when the owning session is gone", async () => {
    const h = harness();
    const started = await h.startThread();
    h.sessions.clear();

    await h.mentionInThread(started.threadTs, after(started.threadTs, 14), "<@U-BOT> hello?");

    expect(await settled(() => h.prompts.length === 1)).toBe(true);
    expect(h.prompts[0]!.resumed).toBeNull();
    expect(h.created).toHaveLength(1);
    expect(await h.ownedThreads.find(OTHER, started.threadTs)).toBeNull();
  });

  // TEST_SCENARIO: an ambient binding does not read an owned thread a second time through the read-along road.
  it("keeps an ambient binding from reading an owned thread twice", async () => {
    const h = harness({ ambient: true });
    const started = await h.startThread();

    await h.replyInThread(started.threadTs, after(started.threadTs, 15), "eu-west");

    expect(await settled(() => h.prompts.length === 1)).toBe(true);
    for (let i = 0; i < 20; i++) await tick();
    expect(h.prompts).toHaveLength(1);
    expect(h.prompts[0]!.resumed).toBe(WEB_SESSION);
  });

  // TEST_SCENARIO: read_thread reads a thread the session owns, though no history ever offered it.
  it("reads an owned thread with read_thread", async () => {
    const h = harness();
    const started = await h.startThread("Which region?");
    await h.replyInThread(started.threadTs, after(started.threadTs, 16), "eu-west");

    const read = await h.worker.readThread(ASKER, {
      threadTs: started.threadTs,
    });
    if ("error" in read) throw new Error(read.error);
    expect(read.conversationId).toBe(OTHER);
    expect(read.messages.join("\n")).toContain("eu-west");
  });
});
