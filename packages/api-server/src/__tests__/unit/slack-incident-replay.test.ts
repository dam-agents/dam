import { createMemoryTtlStore } from "../../core/ttl-store.js";
import { describe, it, expect } from "vitest";
import { type AgentsService } from "api-server-api";
import type { ContentBlock } from "@agentclientprotocol/sdk/dist/schema/types.gen.js";
import { createSlackWorker } from "../../modules/channels/infrastructure/slack.js";
import { createFakeSlackGateway } from "../../modules/channels/infrastructure/fake-slack-gateway.js";
import { stubTurnAttendance } from "../helpers/turn-attendance.js";
import { stubWorkspaceFiles } from "../helpers/workspace-files.js";
import type {
  AcpClient,
  AcpSessionInfo,
  SendPromptOpts,
} from "../../core/acp-client.js";
import { configureLogger } from "../../core/logger.js";
import type { DomainEvent } from "../../events.js";
import type { StoredChannelConfig } from "../../modules/channels/stored-channel.js";

const OWNER = "kc|owner-1";

configureLogger({ level: "error", write: () => {} });

const tick = () => new Promise((r) => setTimeout(r, 0));

type Turn = {
  prompt: string;
  resumed: boolean;
  sessionId: string;
};

/**
 * TEST_OVERVIEW: How a Slack thread keeps one Session across turns, and how a
 * coalesced top-level batch still lets an id-less reply post. The fake ACP here
 * is stateful, unlike the coalescing suite's: listSessions returns the Sessions
 * created so far keyed by their platform threadTs, so a resume can be observed;
 * sendPrompt mints a Session for a fresh prompt and resumes one for a
 * resumeSessionId; steer honours the production promptRequired contract and
 * reports "injected" only while a turn runs, "no-running-turn" otherwise, so it
 * never starts a detached turn.
 */
function statefulHarness(opts?: { settleMs?: number }) {
  const gw = createFakeSlackGateway();
  const events: DomainEvent[] = [];
  const turns: Turn[] = [];
  const steers: { prompt: string; running: boolean }[] = [];
  const sessions: AcpSessionInfo[] = [];
  const gates: Array<() => void> = [];
  let holdTurns = false;
  let running = 0;
  let nextSession = 1;

  const acp: AcpClient = {
    listSessions: async () => sessions.map((s) => ({ ...s })),
    steer: async (_sessionId, prompt) => {
      const wasRunning = running > 0;
      steers.push({
        prompt: typeof prompt === "string" ? prompt : JSON.stringify(prompt),
        running: wasRunning,
      });
      return wasRunning ? "injected" : "no-running-turn";
    },
    sendPrompt: async (prompt: string | ContentBlock[], o: SendPromptOpts) => {
      const text = typeof prompt === "string" ? prompt : JSON.stringify(prompt);
      let sessionId: string;
      let resumed: boolean;
      if ("resumeSessionId" in o) {
        sessionId = o.resumeSessionId;
        resumed = true;
      } else {
        sessionId = `sess-${nextSession++}`;
        resumed = false;
        sessions.push({ sessionId, platform: o.platformMeta ?? null });
      }
      o.onSession?.(sessionId);
      turns.push({ prompt: text, resumed, sessionId });
      running += 1;
      try {
        if (holdTurns) await new Promise<void>((r) => gates.push(r));
      } finally {
        running -= 1;
      }
      return "the answer";
    },
    triggerSession: () => Promise.reject(new Error("unused")),
  };

  const worker = createSlackWorker(
    () => acp,
    () => gw,
    () => ({ ensureReady: async () => {} }) as unknown as AgentsService,
    { resolve: async () => OWNER } as never,
    { authUrl: "http://kc", clientId: "c" } as never,
    createMemoryTtlStore(600_000),
    async () => OWNER,
    {
      resolveSlackBindings: async () => [
        {
          instanceName: "agent-1",
          owner: OWNER,
          ambient: false,
          isDefault: true,
        },
      ],
      resolveSlackChannelsByInstance: async () => ["C1"],
    } as never,
    async () => {},
    async () => {},
    async () => true,
    { name: "DAM", short: "dam" },
    async () => true,
    "http://ui",
    stubTurnAttendance(),
    stubWorkspaceFiles(),
    (e) => events.push(e),
    opts?.settleMs ?? 0,
  );

  return {
    gw,
    worker,
    turns,
    steers,
    sessions,
    events,
    posts: () => gw.readOutbound().filter((r) => r.kind === "message"),
    async start() {
      await worker.start("agent-1", {} as StoredChannelConfig);
    },
    hold() {
      holdTurns = true;
    },
    releaseAll() {
      holdTurns = false;
      for (const g of gates) g();
      gates.length = 0;
    },
    fireTopLevelMention(ts: string, text: string, user = "U1") {
      return gw.fireMention({
        user,
        channel: "C1",
        ts,
        text,
        teamId: "T-e2e",
      });
    },
    fireInThread(ts: string, threadTs: string, text: string, user = "U1") {
      return gw.fireMention({
        user,
        channel: "C1",
        ts,
        threadTs,
        text,
        teamId: "T-e2e",
      });
    },
    async waitFor(done: () => boolean) {
      for (let i = 0; i < 800 && !done(); i++) await tick();
    },
  };
}

describe("slack incident replay — Damathy threaded conversation", () => {
  /**
   * TEST_SCENARIO: The exact incident shape. Jenna @-mentions DAM at top level;
   * DAM answers (turn 1, draft v1) and the turn ends. Ten minutes later she
   * replies IN THE THREAD ("File away!"). That message must (A) be answered at
   * all, and (B) resume turn 1's session so the answer remembers draft v1 — not
   * start a fresh, amnesiac turn. The top-level mention roots the thread at its
   * own ts (100.001); the follow-up replies inside that thread; the assertions
   * check the follow-up ran and reused turn 1's session.
   */
  it("answers an in-thread follow-up and resumes the first turn's session", async () => {
    const h = statefulHarness({ settleMs: 0 });
    await h.start();

    await h.fireTopLevelMention(
      "100.001",
      "@dam draft a reply to the customer",
    );
    await h.waitFor(() => h.turns.length === 1);

    await h.fireInThread("200.001", "100.001", "@dam file it away");
    await h.waitFor(() => h.turns.length === 2);

    expect(h.turns).toHaveLength(2);
    expect(String(h.turns[1]!.prompt)).toContain("file it away");
    expect(h.turns[1]!.resumed).toBe(true);
    expect(h.turns[1]!.sessionId).toBe(h.turns[0]!.sessionId);
  });

  /**
   * TEST_SCENARIO: The overlap #3500 introduced. A top-level @-mention starts
   * the thread and its turn (queue key `top:user`), held mid-flight. Before
   * that turn finishes, the follow-up arrives IN the thread (queue key
   * `thread:root`) — a DIFFERENT coalescing queue. The two queues can only be
   * serialised by the shared session lock (keyed on the thread's session key).
   * Releasing turn 1 lets the follow-up run; this asserts it still (A) runs and
   * (B) resumes turn 1's session rather than opening a parallel, amnesiac one —
   * every session used for the thread is the same one.
   */
  it("resumes the session when the in-thread follow-up overlaps turn 1", async () => {
    const h = statefulHarness({ settleMs: 0 });
    await h.start();

    h.hold();
    void h.fireTopLevelMention("100.001", "@dam draft a reply to the customer");
    await h.waitFor(() => h.turns.length === 1);

    void h.fireInThread("200.001", "100.001", "@dam file it away");
    await h.waitFor(() => h.steers.length > 0 || h.turns.length === 2);

    h.releaseAll();
    await h.waitFor(() => h.turns.length === 2 && h.turns[1]!.resumed);

    expect(h.turns.length).toBeGreaterThanOrEqual(2);
    const followUp = h.turns.find((t) => t.prompt.includes("file it away"));
    expect(followUp, "the follow-up produced a turn").toBeDefined();
    const sessionIds = new Set(h.turns.map((t) => t.sessionId));
    expect(sessionIds.size, "one session for the whole thread").toBe(1);
  });
});

describe("slack incident replay — coalesced top-level batch drops the reply (#3500)", () => {
  /**
   * TEST_SCENARIO: Symptom A of the Damathy incident — "my draft never made it
   * to the channel". Two top-level @-mentions from the SAME user, the second
   * arriving while the first turn is still composing (turn 1 is held
   * mid-flight). #3500 steered the second into the running turn and `onSteered`
   * registered it as a second live turn ref whose reply target was its own
   * eventTs — a DIFFERENT thread from the first ref. So an id-less reply saw two
   * live refs pointing at two threads, was called ambiguous, and was REFUSED;
   * the agent's answer never reached Slack. Before #3500 these two mentions ran
   * as two SEQUENTIAL turns (serialised by `withSessionTurnLock`), each with a
   * single live ref, so an id-less reply resolved to the sole in-flight thread
   * and posted — coalescing manufactured an ambiguity that did not exist. The
   * fix makes both refs share the conversation anchor; this asserts the id-less
   * reply is NOT refused and reaches the channel. It fails on the #3500 code and
   * is the regression guard for the fix.
   */
  it("does not refuse the agent's id-less reply after a same-user top-level mention is steered in", async () => {
    const h = statefulHarness({ settleMs: 0 });
    await h.start();

    h.hold();
    void h.fireTopLevelMention(
      "100.001",
      "@dam file an issue about the flaky test",
    );
    await h.waitFor(() => h.turns.length === 1);

    void h.fireTopLevelMention("200.001", "@dam actually, hello first");
    await h.waitFor(() => h.steers.length > 0);
    expect(
      h.steers[0]!.running,
      "the second mention was steered mid-turn",
    ).toBe(true);

    const result = await h.worker.reply("agent-1", {
      text: "Here is the draft issue …",
    });

    expect(result).toEqual({ ok: true });
    expect(
      h.posts().some((p) => p.text.includes("Here is the draft issue")),
      "the agent's reply reached the channel",
    ).toBe(true);

    h.releaseAll();
    await h.waitFor(() => h.turns.length >= 1);
  });
});
