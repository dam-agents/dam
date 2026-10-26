import { createMemoryTtlStore } from "../../core/ttl-store.js";
import { describe, it, expect } from "vitest";
import type { AgentsService } from "api-server-api";
import { createSlackWorker } from "../../modules/channels/infrastructure/slack.js";
import { createFakeSlackGateway } from "../../modules/channels/infrastructure/fake-slack-gateway.js";
import { stubTurnAttendance } from "../helpers/turn-attendance.js";
import { stubWorkspaceFiles } from "../helpers/workspace-files.js";
import type { AcpClient } from "../../core/acp-client.js";
import { configureLogger } from "../../core/logger.js";
import {
  EventType,
  type ChannelTurnRelayed,
  type DomainEvent,
} from "../../events.js";

/**
 * TEST_OVERVIEW: A message posted outside a thread and a reply in its thread
 * reach the Agent through separate queues and sessions, so without a rule
 * they run as two turns at once — the reported bug filed every issue twice.
 * A reply in the thread supersedes the Agent's running turn on the opener:
 * that turn is cancelled, the thread's turn starts only once it has ended,
 * and the thread's turn is told what the cancelled one already did. A
 * read-along turn not started yet leaves the opener out instead.
 */

const OWNER = "kc|owner-1";

configureLogger({ level: "error", write: () => {} });

const tick = () => new Promise((r) => setTimeout(r, 0));

type Turn = {
  prompt: string;
  aborted: () => boolean;
  finish: (answer?: string) => void;
};

function harness() {
  const gw = createFakeSlackGateway();
  const events: DomainEvent[] = [];
  const turns: Turn[] = [];
  let tool: string | null = null;

  const acp: AcpClient = {
    steer: async () => "unsupported" as const,
    listSessions: async () => [],
    sendPrompt: (prompt, o) => {
      const text = String(prompt);
      if (text.includes("<turn-undelivered>")) return Promise.resolve("");
      o.onSession?.(`sess-${turns.length}`);
      if (tool) o.onUpdate?.({ kind: "tool", title: tool });
      return new Promise<string>((resolve) => {
        const finish = (answer = "") => resolve(answer);
        o.signal?.addEventListener("abort", () => finish(), { once: true });
        turns.push({
          prompt: text,
          aborted: () => o.signal?.aborted === true,
          finish,
        });
      });
    },
    triggerSession: () => Promise.reject(new Error("unused")),
    turnStatus: async () => "unknown" as const,
  };

  const worker = createSlackWorker({
    makeAcpClient: () => acp,
    createGateway: () => gw,
    agents: () => ({ ensureReady: async () => {} }) as unknown as AgentsService,
    identityLinks: { resolve: async () => null } as never,
    oauthConfig: { authUrl: "http://kc", clientId: "c" } as never,
    pendingOAuthFlows: createMemoryTtlStore(600_000),
    getInstanceOwner: async () => OWNER,
    ownerDisplayName: async () => null,
    channelRegistry: {
      resolveSlackBindings: async () => [
        {
          instanceName: "agent-1",
          owner: OWNER,
          ambient: true,
          isDefault: true,
        },
      ],
      resolveSlackChannelsByInstance: async () => [{ id: "C1", teamId: "" }],
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
    emit: (e) => events.push(e),
    settleMs: 0,
  });

  return {
    worker,
    turns,
    usesTool(title: string | null) {
      tool = title;
    },
    async start() {
      await worker.connect();
    },
    post(ts: string, text: string, threadTs?: string) {
      return gw.fireMessage({
        user: "U-JAN",
        channel: "C1",
        ts,
        ...(threadTs ? { threadTs } : {}),
        text,
      });
    },
    mention(ts: string, text: string, threadTs: string) {
      return gw.fireMention({
        user: "U-JAN",
        channel: "C1",
        ts,
        threadTs,
        text,
      });
    },
    async until(done: () => boolean) {
      for (let i = 0; i < 100 && !done(); i++) await tick();
      expect(done()).toBe(true);
    },
    turnEvents: () =>
      events.filter(
        (e): e is ChannelTurnRelayed =>
          e.type === EventType.ChannelTurnRelayed &&
          e.reason !== "recovery-nudge",
      ),
  };
}

describe("slack — a thread reply supersedes the agent's turn on its opener", () => {
  /**
   * TEST_SCENARIO: The reported sequence: a task posted at the top of a
   * channel the Agent reads along in, then, while that read-along turn runs, a
   * reply in its thread tagging the Agent — "grab it". The read-along turn is
   * cancelled, the thread's turn starts only after it ended, and it is told
   * what the cancelled turn already ran so it does not do that again.
   */
  it("cancels the running read-along turn before the thread's turn starts", async () => {
    const h = harness();
    await h.start();
    h.usesTool("gh issue create");

    await h.post("100.1", "file issues for the three bugs");
    await h.until(() => h.turns.length === 1);
    expect(h.turns[0]!.prompt).toContain("<reading-along>");

    h.usesTool(null);
    void h.mention("100.2", "<@U-BOT> grab it", "100.1");
    await h.until(() => h.turns.length === 2);

    expect(h.turns[0]!.aborted()).toBe(true);
    const thread = h.turns[1]!.prompt;
    expect(thread).toContain("<addressed-to-you>");
    expect(thread).toContain("<earlier-turn>");
    expect(thread).toContain("That turn was stopped");
    expect(thread).toContain("- gh issue create");
    expect(thread).toContain("do not do it a second time");

    h.turns[1]!.finish();
    await h.until(() => h.turnEvents().length === 2);
    const readAlong = h.turnEvents().find((e) => e.ambient === true);
    expect(readAlong).toMatchObject({
      outcome: "success",
      reason: "superseded",
    });
  });

  /**
   * TEST_SCENARIO: An untagged reply in the thread reaches a read-along Agent
   * too, and is the same request coming back; it must supersede the
   * top-level turn in the same way rather than run beside it.
   */
  it("an untagged reply in the thread supersedes it as well", async () => {
    const h = harness();
    await h.start();

    await h.post("100.1", "who can take the flaky test?");
    await h.until(() => h.turns.length === 1);

    await h.post("100.2", "actually, it's fixed already", "100.1");
    await h.until(() => h.turns.length === 2);

    expect(h.turns[0]!.aborted()).toBe(true);
    expect(h.turns[1]!.prompt).toContain("actually, it's fixed already");
    expect(h.turns[1]!.prompt).toContain("<earlier-turn>");
    expect(h.turns[1]!.prompt).toContain(
      "It had not run a tool or posted anything yet.",
    );
    h.turns[1]!.finish();
  });

  /**
   * TEST_SCENARIO: When the reply arrives before the read-along turn on its
   * opener has started — here it queues behind an earlier one — the opener is
   * left out of the read-along turn, so only the thread's turn acts on it.
   */
  it("leaves the opener out of a read-along turn that had not started", async () => {
    const h = harness();
    await h.start();

    await h.post("100.1", "good morning");
    await h.until(() => h.turns.length === 1);
    await h.post("100.5", "file issues for the three bugs");

    void h.mention("100.6", "<@U-BOT> grab it", "100.5");
    await h.until(() => h.turns.length === 2);
    expect(h.turns[0]!.aborted()).toBe(false);
    expect(h.turns[1]!.prompt).toContain("<addressed-to-you>");
    expect(h.turns[1]!.prompt).not.toContain("<earlier-turn>");

    h.turns[0]!.finish();
    h.turns[1]!.finish();
    await h.until(() => h.turnEvents().length === 2);
    for (let i = 0; i < 20; i++) await tick();
    expect(h.turns).toHaveLength(2);
  });

  /**
   * TEST_SCENARIO: A reply under some other message must not touch a
   * read-along turn on an unrelated one: the two are separate requests.
   */
  it("leaves a turn on another message running", async () => {
    const h = harness();
    await h.start();

    await h.post("100.1", "file issues for the three bugs");
    await h.until(() => h.turns.length === 1);

    void h.mention("100.8", "<@U-BOT> what about this one?", "99.0");
    await h.until(() => h.turns.length === 2);

    expect(h.turns[0]!.aborted()).toBe(false);
    expect(h.turns[1]!.prompt).not.toContain("<earlier-turn>");
    h.turns[0]!.finish();
    h.turns[1]!.finish();
  });
});
