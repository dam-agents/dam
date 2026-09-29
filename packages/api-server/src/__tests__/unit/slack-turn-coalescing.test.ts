import { createMemoryTtlStore } from "../../core/ttl-store.js";
import { describe, it, expect } from "vitest";
import { type AgentsService } from "api-server-api";
import type { ContentBlock } from "@agentclientprotocol/sdk";
import { createSlackWorker } from "../../modules/channels/infrastructure/slack.js";
import { createFakeSlackGateway } from "../../modules/channels/infrastructure/fake-slack-gateway.js";
import { stubTurnAttendance } from "../helpers/turn-attendance.js";
import { stubWorkspaceFiles } from "../helpers/workspace-files.js";
import type { AcpClient, SteerOutcome } from "../../core/acp-client.js";
import { configureLogger } from "../../core/logger.js";
import type { DomainEvent } from "../../events.js";

const OWNER = "kc|owner-1";
const SESSION = "sess-1";

configureLogger({ level: "error", write: () => {} });

const tick = () => new Promise((r) => setTimeout(r, 0));

/**
 * TEST_OVERVIEW: How an addressed Slack conversation turns several messages
 * into one answer. Messages waiting when a turn has not started yet go into
 * that turn together. A message arriving while a turn runs is steered into it,
 * so the agent reads it before it calls its reply tool and answers once. Where
 * the harness does not support steering the message waits and becomes the next
 * turn, which is the old behaviour minus the extra turns. These agents never
 * call the reply tool, so every turn here also draws a delivery nudge; the
 * harness keeps those apart from turn prompts so the counts below stay about
 * coalescing alone.
 */

type Gate = { release: () => void };

function harness(opts: { steer?: () => SteerOutcome; settleMs?: number } = {}) {
  const gw = createFakeSlackGateway();
  const events: DomainEvent[] = [];
  const prompts: Array<string | ContentBlock[]> = [];
  const nudges: Array<string | ContentBlock[]> = [];
  const steered: string[] = [];
  const sessionKeys: string[] = [];
  const gates: Gate[] = [];
  let holdTurns = false;

  const acp: AcpClient = {
    listSessions: async () => [],
    steer: async (_sessionId, prompt) => {
      steered.push(
        typeof prompt === "string" ? prompt : JSON.stringify(prompt),
      );
      return opts.steer ? opts.steer() : "unsupported";
    },
    sendPrompt: async (prompt, sendOpts) => {
      if (String(prompt).includes("<turn-undelivered>")) {
        nudges.push(prompt);
        return "nudged";
      }
      prompts.push(prompt);
      const meta = (sendOpts as { platformMeta?: { threadTs?: string } })
        .platformMeta;
      if (meta?.threadTs !== undefined) sessionKeys.push(meta.threadTs);
      sendOpts.onSession?.(
        meta?.threadTs ? `${SESSION}-${meta.threadTs}` : SESSION,
      );
      if (holdTurns) {
        await new Promise<void>((resolve) => gates.push({ release: resolve }));
      }
      return "the answer";
    },
    triggerSession: () => Promise.reject(new Error("unused")),
    turnStatus: async () => "unknown" as const,
  };

  const worker = createSlackWorker({
    makeAcpClient: () => acp,
    createGateway: () => gw,
    agents: () => ({ ensureReady: async () => {} }) as unknown as AgentsService,
    identityLinks: { resolve: async () => OWNER } as never,
    oauthConfig: { authUrl: "http://kc", clientId: "c" } as never,
    pendingOAuthFlows: createMemoryTtlStore(600_000),
    getInstanceOwner: async () => OWNER,
    channelRegistry: {
      resolveSlackBindings: async () => [
        {
          instanceName: "agent-1",
          owner: OWNER,
          ambient: false,
          isDefault: true,
        },
      ],
      resolveSlackChannelsByInstance: async () => [{ id: "C1", teamId: "" }],
    } as never,
    unbindSlackChannel: async () => {},
    setSlackChannelAmbient: async () => {},
    setSlackDefault: async () => true,
    brand: { name: "DAM", short: "dam" },
    isTermsAccepted: async () => true,
    uiBaseUrl: "http://ui",
    attendance: stubTurnAttendance(),
    workspaceFiles: stubWorkspaceFiles(),
    listWorkspaces: async () => [],
    emit: (e) => events.push(e),
    settleMs: opts.settleMs ?? 0,
  });

  return {
    gw,
    prompts,
    nudges,
    steered,
    sessionKeys,
    worker,
    async start() {
      await worker.start("agent-1");
    },
    hold() {
      holdTurns = true;
    },
    releaseAll() {
      holdTurns = false;
      for (const g of gates) g.release();
      gates.length = 0;
    },
    fire(ts: string, text: string, threadTs?: string, user = "U1") {
      return gw.fireMention({
        user,
        channel: "C1",
        ts,
        ...(threadTs !== undefined ? { threadTs } : {}),
        text,
        teamId: "T-e2e",
      });
    },
    fireDm(ts: string, text: string, user = "U1") {
      return gw.fireDirectMessage({
        user,
        channel: "D1",
        ts,
        text,
        teamId: "T-e2e",
      });
    },
    async waitFor(done: () => boolean) {
      for (let i = 0; i < 400 && !done(); i++) await tick();
    },
  };
}

describe("slack addressed turns — coalescing", () => {
  /**
   * TEST_SCENARIO: A thought split over two messages in a thread, both arriving
   * before the turn starts, must produce one turn carrying both — the reported
   * bug was one turn (and one answer) per message.
   */
  it("carries a settled burst into a single turn", async () => {
    const h = harness({ settleMs: 5 });
    await h.start();

    const first = h.fire("100.1", "can you check the deploy", "T1");
    await tick();
    const second = h.fire("100.2", "specifically the migration", "T1");
    await Promise.all([first, second]);

    expect(h.prompts).toHaveLength(1);
    const prompt = String(h.prompts[0]);
    expect(prompt).toContain("can you check the deploy");
    expect(prompt).toContain("specifically the migration");
    expect(prompt).toContain("[ts 100.1]");
    expect(prompt).toContain("[ts 100.2]");
  });

  /**
   * TEST_SCENARIO: The mid-turn case steering exists for: the agent is already
   * working when the rest of the thought lands. It must reach the running turn
   * rather than start a second one, so the conversation gets one answer.
   */
  it("steers a message that arrives while a turn is running", async () => {
    const h = harness({ steer: () => "injected" });
    await h.start();
    h.hold();

    void h.fire("100.1", "can you check the deploy", "T1");
    await h.waitFor(() => h.prompts.length === 1);

    void h.fire("100.2", "specifically the migration", "T1");
    await h.waitFor(() => h.steered.length === 1);

    expect(h.steered).toHaveLength(1);
    expect(h.steered[0]).toContain("specifically the migration");
    expect(h.steered[0]).toContain("answer everything in one reply");

    h.releaseAll();
    await h.waitFor(() => false);
    expect(h.prompts).toHaveLength(1);
  });

  /**
   * TEST_SCENARIO: Not every harness supports steering. There the message must
   * still be answered — as the next turn — rather than dropped, and it must not
   * run alongside the turn already in flight.
   */
  it("falls back to a following turn when the harness cannot be steered", async () => {
    const h = harness({ steer: () => "unsupported" });
    await h.start();
    h.hold();

    void h.fire("100.1", "first half", "T1");
    await h.waitFor(() => h.prompts.length === 1);

    void h.fire("100.2", "second half", "T1");
    await h.waitFor(() => h.steered.length === 1);
    expect(h.prompts).toHaveLength(1);

    h.releaseAll();
    await h.waitFor(() => h.prompts.length === 2);

    expect(h.prompts).toHaveLength(2);
    expect(String(h.prompts[1])).toContain("second half");
  });

  /**
   * TEST_SCENARIO: a steered message joins the running turn as a turn ref of
   * its own, minted outside the batch the turn started with. An agent that
   * answers that message has answered the turn, so the delivery verdict must
   * see that ref too — judging on the starting batch alone reads the turn as
   * silent and sends the person the same answer a second time.
   */
  it("counts a reply to a steered message as the turn being answered", async () => {
    const h = harness({ steer: () => "injected" });
    await h.start();
    h.hold();

    void h.fire("100.1", "how do we deploy?", "T1");
    await h.waitFor(() => h.prompts.length === 1);

    void h.fire("100.2", "specifically the migration", "T1");
    await h.waitFor(() => h.steered.length === 1);

    await h.worker.reply("agent-1", { text: "answered", threadTs: "T1" });

    h.releaseAll();
    await h.waitFor(() => false);

    expect(h.nudges).toHaveLength(0);
  });

  /**
   * TEST_SCENARIO: The #4023 bug. In a channel a second top-level mention only
   * reaches the agent because the person tagged it again, so it is a new
   * request, not the rest of a thought — even from the same person, even while
   * the first is still running. Each one must open its own thread session, or
   * one answer lands in the other's thread and the first thread gets nothing.
   */
  it("gives each of one person's top-level mentions its own turn and session", async () => {
    const h = harness({ steer: () => "injected" });
    await h.start();
    h.hold();

    void h.fire("100.1", "run the long thing");
    await h.waitFor(() => h.prompts.length === 1);

    void h.fire("200.2", "separate question: what is 17 x 23?");
    await h.waitFor(() => h.prompts.length === 2);

    expect(h.steered).toHaveLength(0);
    expect(h.sessionKeys).toEqual(["C1:100.1", "C1:200.2"]);
    expect(String(h.prompts[0])).toContain("run the long thing");
    expect(String(h.prompts[0])).not.toContain("17 x 23");
    expect(String(h.prompts[1])).toContain("17 x 23");
    expect(String(h.prompts[1])).toContain('threadTs="200.2"');

    h.releaseAll();
    await h.waitFor(() => false);
  });

  /**
   * TEST_SCENARIO: The other half of #4023. A follow-up posted inside the
   * thread a turn is answering belongs to that turn — "wait, don't approve
   * yet" is worthless once the approval is out. It must be steered into the
   * running turn rather than queued behind it.
   */
  it("steers a thread reply into the top-level turn it belongs to", async () => {
    const h = harness({ steer: () => "injected" });
    await h.start();
    h.hold();

    void h.fire("100.1", "approve the release");
    await h.waitFor(() => h.prompts.length === 1);

    void h.fire("100.5", "wait, do not approve yet", "100.1");
    await h.waitFor(() => h.steered.length === 1);

    expect(h.prompts).toHaveLength(1);
    expect(h.steered[0]).toContain("wait, do not approve yet");
    expect(h.steered[0]).not.toContain("pass the [ts");

    h.releaseAll();
    await h.waitFor(() => false);
  });

  /**
   * TEST_SCENARIO: A 1:1 DM is the case merging was built for — no tag is
   * needed, so people really do type one thought in pieces, and only they see
   * the answer. Splitting a DM burst per message is what the channel rule must
   * not spread to.
   */
  it("still merges a 1:1 DM burst from one person", async () => {
    const h = harness({ settleMs: 5 });
    await h.start();

    const a = h.fireDm("100.1", "can you look at the deploy");
    const b = h.fireDm("200.2", "the migration one specifically");
    await Promise.all([a, b]);

    expect(h.prompts).toHaveLength(1);
    const prompt = String(h.prompts[0]);
    expect(prompt).toContain("can you look at the deploy");
    expect(prompt).toContain("the migration one specifically");
    expect(prompt).toContain("an id-less reply is refused");
  });

  /**
   * TEST_SCENARIO: A decline naming a turn the agent is not running is a
   * mistake, not a silence. Answering ok would record nothing and leave the
   * turn looking unanswered, so the delivery nudge would push the agent into
   * posting the reply it withheld — the same failure an unnamed decline had.
   */
  it("refuses a decline that names no turn the agent is running", async () => {
    const h = harness({ steer: () => "injected" });
    await h.start();

    expect(await h.worker.declineTurn("agent-1", "999.9")).toMatchObject({
      error: expect.stringContaining("999.9"),
    });

    h.hold();
    void h.fire("100.1", "run the long thing");
    await h.waitFor(() => h.prompts.length === 1);

    expect(await h.worker.declineTurn("agent-1", "999.9")).toMatchObject({
      error: expect.stringContaining("999.9"),
    });

    h.releaseAll();
    await h.waitFor(() => h.nudges.length === 1);

    expect(h.nudges).toHaveLength(1);
  });

  /**
   * TEST_SCENARIO: Two people addressing the agent about different things are
   * two conversations, not one thought — merging them would answer one person
   * under the other's message. Each top-level mention roots its own thread, so
   * they stay separate turns whoever sent them.
   */
  it("keeps two senders' top-level mentions apart", async () => {
    const h = harness({ settleMs: 5 });
    await h.start();

    const a = h.fire("100.1", "question from one", undefined, "U1");
    const b = h.fire("200.2", "question from two", undefined, "U2");
    await Promise.all([a, b]);

    expect(h.prompts).toHaveLength(2);
  });

  /**
   * TEST_SCENARIO: The quiet period is what merges a split thought, and it must
   * not merge two top-level mentions that only look like one because they
   * arrived close together. Same person, same channel, inside the same quiet
   * period — still two requests, so still two turns.
   */
  it("does not merge one person's top-level mentions inside the quiet period", async () => {
    const h = harness({ settleMs: 5 });
    await h.start();

    const a = h.fire("100.1", "question one");
    const b = h.fire("200.2", "question two");
    await Promise.all([a, b]);

    expect(h.prompts).toHaveLength(2);
    expect(h.sessionKeys).toEqual(["C1:100.1", "C1:200.2"]);
  });

  /**
   * TEST_SCENARIO: A mention and a reply the sender adds under it inside the
   * quiet period are one thread, so they are one turn. The turn opened at the
   * top level, so it is framed that way and answers into the thread the
   * mention roots — one target, not one per message.
   */
  it("carries a mention and a reply under it into one thread turn", async () => {
    const h = harness({ settleMs: 5 });
    await h.start();

    const a = h.fire("100.1", "can you check the deploy");
    const b = h.fire("100.5", "the migration one", "100.1");
    await Promise.all([a, b]);

    expect(h.prompts).toHaveLength(1);
    expect(h.sessionKeys).toEqual(["C1:100.1"]);
    const prompt = String(h.prompts[0]);
    expect(prompt).toContain("can you check the deploy");
    expect(prompt).toContain("the migration one");
    expect(prompt).toContain('threadTs="100.1"');
    expect(prompt).not.toContain("an id-less reply is refused");
  });

  /**
   * TEST_SCENARIO: Concurrent top-level turns are the normal case now, and
   * no_reply_needed has to say which of them it is ending. Unnamed it cannot
   * be resolved, and answering ok anyway would leave the turn looking
   * unanswered — the delivery nudge would then push the agent into posting the
   * very reply it decided to withhold.
   */
  it("declines the turn it names while another is in flight", async () => {
    const h = harness({ steer: () => "injected" });
    await h.start();
    h.hold();

    void h.fire("100.1", "run the long thing");
    await h.waitFor(() => h.prompts.length === 1);
    void h.fire("200.2", "thanks, ignore that");
    await h.waitFor(() => h.prompts.length === 2);

    const unnamed = await h.worker.declineTurn("agent-1");
    expect(unnamed).toMatchObject({
      error: expect.stringContaining("more than one"),
    });

    expect(await h.worker.declineTurn("agent-1", "200.2")).toEqual({
      ok: true,
    });

    h.releaseAll();
    await h.waitFor(() => h.nudges.length === 1);
    await h.waitFor(() => false);

    expect(h.nudges).toHaveLength(1);
    expect(String(h.nudges[0])).toContain("100.1");
  });

  /**
   * TEST_SCENARIO: A single message must not gain batch framing — the [ts …]
   * tags and the multi-message contract only make sense for a real batch.
   */
  it("leaves a lone message unbatched", async () => {
    const h = harness({ settleMs: 5 });
    await h.start();

    await h.fire("100.1", "just the one", "T1");

    expect(h.prompts).toHaveLength(1);
    expect(String(h.prompts[0])).not.toContain("[ts 100.1]");
  });
});
