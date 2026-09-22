import { describe, it, expect } from "vitest";
import { configureLogger } from "../../core/logger.js";
import { slackWorkerHarness } from "../helpers/slack-worker.js";
import type { AcpClient } from "../../core/acp-client.js";
import {
  selectUnseen,
  type ThreadEntry,
} from "../../modules/channels/domain/thread-catch-up.js";

configureLogger({ level: "error", write: () => {} });

const BOUND = "C1";
const AWAY = "You were away";

const ALPHA = "alpha says hello";
const BRAVO = "bravo follows up";
const CHARLIE = "charlie chimes in";
const DELTA = "delta wraps up";

const T1 = "100.000000";
const T2 = "200.000000";
const T3 = "300.000000";
const T4 = "400.000000";

function countAcross(prompts: Array<unknown>, sub: string): number {
  const all = prompts.map(String).join("\n");
  return all.split(sub).length - 1;
}

/**
 * TEST_OVERVIEW: The seen-boundary bookkeeping behind the "You were away"
 * catch-up. The away block may only hold messages the session would otherwise
 * never receive. So a message still queued for its own turn never appears in
 * it; a delivered batch moves the boundary to its newest send time, whatever
 * order Slack delivered the events in; a message steered into a delivered turn
 * counts as seen; a failed turn leaves the boundary where it was, so the next
 * turn shows its messages again; and a read that hits its limit never moves
 * the boundary past the messages the turn was shown.
 */
const harness = (opts: Parameters<typeof slackWorkerHarness>[0] = {}) =>
  slackWorkerHarness({
    boundChannelId: BOUND,
    channels: [{ id: BOUND, name: "general", botIsMember: true }],
    ...opts,
  });

function gatedAcp(opts: {
  blockCall: number;
  failOnRelease?: boolean;
  steerOutcome?: "injected" | "unsupported";
}) {
  let call = 0;
  let release!: () => void;
  let started!: () => void;
  const startedAt = new Promise<void>((resolve) => (started = resolve));
  const gate = new Promise<void>((resolve) => (release = resolve));
  const steers: string[] = [];
  const hooks: { answerTurn?: () => Promise<void> } = {};
  const makeAcp = (base: AcpClient): AcpClient => ({
    ...base,
    steer: async (_sessionId, frame) => {
      steers.push(String(frame));
      return opts.steerOutcome ?? "unsupported";
    },
    sendPrompt: async (prompt, sendOpts) => {
      call += 1;
      sendOpts.onSession?.(
        "resumeSessionId" in sendOpts &&
          typeof sendOpts.resumeSessionId === "string"
          ? sendOpts.resumeSessionId
          : "s-live",
      );
      if (call === opts.blockCall) {
        started();
        await gate;
        if (opts.failOnRelease) throw new Error("turn lost");
      }
      await hooks.answerTurn?.();
      return base.sendPrompt(prompt, sendOpts);
    },
  });
  return { makeAcp, steers, startedAt, hooks, release: () => release() };
}

describe("channel catch-up stays behind the delivered batch", () => {
  /**
   * TEST_SCENARIO: A message can already be in the channel history while it is
   * still queued for its own turn. The turn answering an earlier message must
   * not show it as missed: it is delivered a moment later as its own turn, so
   * showing it twice would ask the agent to answer it twice.
   */
  it("does not present a queued newer message as missed", async () => {
    const h = harness({ ambient: true });
    h.gw.setHistory([{ ts: T1, user: "U9", text: ALPHA }]);
    await h.worker.connect();

    await h.gw.fireMessage({ user: "U9", channel: BOUND, ts: T1, text: ALPHA });
    expect(await h.settled(() => h.prompts.length === 1)).toBe(true);

    h.gw.setHistory([
      { ts: T1, user: "U9", text: ALPHA },
      { ts: T2, user: "U9", text: BRAVO },
      { ts: T3, user: "U9", text: CHARLIE },
    ]);
    await h.gw.fireMessage({ user: "U9", channel: BOUND, ts: T2, text: BRAVO });
    expect(await h.settled(() => h.prompts.length === 2)).toBe(true);

    expect(String(h.prompts[1])).not.toContain(AWAY);
    expect(String(h.prompts[1])).not.toContain(CHARLIE);

    await h.gw.fireMessage({
      user: "U9",
      channel: BOUND,
      ts: T3,
      text: CHARLIE,
    });
    expect(await h.settled(() => h.prompts.length === 3)).toBe(true);

    expect(String(h.prompts[2])).not.toContain(AWAY);
    expect(countAcross(h.prompts, CHARLIE)).toBe(1);
  });

  /**
   * TEST_SCENARIO: Slack can deliver two messages swapped, so a batch's last
   * arrival is not its newest send. The boundary must advance to the newest
   * send-ts in the batch, or the later-sent batch-mate is re-presented as
   * missed by the turn after it.
   */
  it("advances the boundary to the newest send-ts, not the last arrival", async () => {
    const gate = gatedAcp({ blockCall: 1 });
    const h = harness({ ambient: true, makeAcp: gate.makeAcp });
    h.gw.setHistory([{ ts: T1, user: "U9", text: ALPHA }]);
    await h.worker.connect();

    await h.gw.fireMessage({ user: "U9", channel: BOUND, ts: T1, text: ALPHA });
    await gate.startedAt;

    h.gw.setHistory([
      { ts: T1, user: "U9", text: ALPHA },
      { ts: T2, user: "U9", text: BRAVO },
      { ts: T3, user: "U9", text: CHARLIE },
    ]);
    await h.gw.fireMessage({
      user: "U9",
      channel: BOUND,
      ts: T3,
      text: CHARLIE,
    });
    await h.gw.fireMessage({ user: "U9", channel: BOUND, ts: T2, text: BRAVO });
    gate.release();
    expect(await h.settled(() => h.prompts.length === 2)).toBe(true);
    expect(String(h.prompts[1])).toContain(`[ts ${T3}]`);
    expect(String(h.prompts[1])).toContain(`[ts ${T2}]`);

    h.gw.setHistory([
      { ts: T1, user: "U9", text: ALPHA },
      { ts: T2, user: "U9", text: BRAVO },
      { ts: T3, user: "U9", text: CHARLIE },
      { ts: T4, user: "U9", text: DELTA },
    ]);
    await h.gw.fireMessage({ user: "U9", channel: BOUND, ts: T4, text: DELTA });
    expect(await h.settled(() => h.prompts.length === 3)).toBe(true);

    expect(String(h.prompts[2])).not.toContain(AWAY);
    expect(countAcross(h.prompts, CHARLIE)).toBe(1);
  });

  /**
   * TEST_SCENARIO: A read that hits its limit must not move the boundary past
   * what the turn was shown. Slack returns the newest messages of a channel,
   * so the newest message in that window can be newer than the delivered
   * batch, and the prompt leaves those out on purpose. If the boundary took
   * the window's newest message, the ones left out would count as seen and no
   * later turn would ever show them.
   */
  it("keeps the boundary behind a capped read's unshown tail", async () => {
    const h = harness({ ambient: true });
    h.gw.setHistory([{ ts: T1, user: "U9", text: ALPHA }]);
    await h.worker.connect();

    await h.gw.fireMessage({ user: "U9", channel: BOUND, ts: T1, text: ALPHA });
    expect(await h.settled(() => h.prompts.length === 1)).toBe(true);

    const flood = Array.from({ length: 520 }, (_, i) => ({
      ts: `${1000 + i}.000000`,
      user: "U7",
      text: `flood ${i}`,
    }));
    h.gw.setHistory([
      { ts: T1, user: "U9", text: ALPHA },
      { ts: T2, user: "U9", text: BRAVO },
      ...flood,
    ]);
    await h.gw.fireMessage({ user: "U9", channel: BOUND, ts: T2, text: BRAVO });
    expect(await h.settled(() => h.prompts.length === 2)).toBe(true);
    expect(String(h.prompts[1])).not.toContain("flood 519");

    h.gw.setHistory([
      { ts: T1, user: "U9", text: ALPHA },
      { ts: T2, user: "U9", text: BRAVO },
      ...flood,
      { ts: "9000.000000", user: "U9", text: DELTA },
    ]);
    await h.gw.fireMessage({
      user: "U9",
      channel: BOUND,
      ts: "9000.000000",
      text: DELTA,
    });
    expect(await h.settled(() => h.prompts.length === 3)).toBe(true);

    const caught = String(h.prompts[2]);
    expect(caught).toContain(AWAY);
    expect(caught).toContain("flood 519");
  });

  /**
   * TEST_SCENARIO: Messages that no turn ever carried, because the agent was
   * away when they arrived, must still be shown under the away legend. The
   * limits added for live traffic must not stop this recovery.
   */
  it("still hands a genuine gap to the agent under the away legend", async () => {
    const h = harness({ ambient: true });
    h.gw.setHistory([{ ts: T1, user: "U9", text: ALPHA }]);
    await h.worker.connect();

    await h.gw.fireMessage({ user: "U9", channel: BOUND, ts: T1, text: ALPHA });
    expect(await h.settled(() => h.prompts.length === 1)).toBe(true);

    h.gw.setHistory([
      { ts: T1, user: "U9", text: ALPHA },
      { ts: T2, user: "U9", text: BRAVO },
      { ts: T3, user: "U9", text: CHARLIE },
      { ts: T4, user: "U9", text: DELTA },
    ]);
    await h.gw.fireMessage({ user: "U9", channel: BOUND, ts: T4, text: DELTA });
    expect(await h.settled(() => h.prompts.length === 2)).toBe(true);

    const caught = String(h.prompts[1]);
    expect(caught).toContain(AWAY);
    expect(caught).toContain(BRAVO);
    expect(caught).toContain(CHARLIE);
  });
});

describe("a turn's own messages are not also context", () => {
  /**
   * TEST_SCENARIO: A burst answered as one turn carries every message in its
   * own text. Those same messages are in the conversation the relay reads for
   * history, so a fresh session must leave all of them out of the history
   * block, not only the one that happened to arrive last.
   */
  it("keeps every batched message out of a fresh turn's history", async () => {
    const h = harness({ settleMs: 5 });
    const ROOT = "1.000000";
    h.gw.setThreadedHistory([
      { ts: ROOT, user: "U9", text: "thread root", threadTs: ROOT },
      { ts: T1, user: "U9", text: ALPHA, threadTs: ROOT },
      { ts: T2, user: "U9", text: BRAVO, threadTs: ROOT },
    ]);
    await h.worker.connect();

    const first = h.gw.fireMention({
      user: "U9",
      channel: BOUND,
      ts: T1,
      threadTs: ROOT,
      text: ALPHA,
    });
    const second = h.gw.fireMention({
      user: "U9",
      channel: BOUND,
      ts: T2,
      threadTs: ROOT,
      text: BRAVO,
    });
    await Promise.all([first, second]);

    expect(h.prompts).toHaveLength(1);
    const prompt = String(h.prompts[0]);
    expect(prompt).toContain(`[ts ${T1}]`);
    expect(prompt).toContain(`[ts ${T2}]`);
    expect(countAcross(h.prompts, ALPHA)).toBe(1);
    expect(countAcross(h.prompts, BRAVO)).toBe(1);
  });
});

describe("steered messages and the boundary", () => {
  const ROOT = "1.000000";
  const thread = { threadTs: ROOT };
  const threadedHistory = (upTo: number) =>
    [
      { ts: ROOT, user: "U9", text: "thread root", threadTs: ROOT },
      { ts: T1, user: "U9", text: ALPHA, ...thread },
      { ts: T2, user: "U9", text: BRAVO, ...thread },
      { ts: T3, user: "U9", text: CHARLIE, ...thread },
      { ts: T4, user: "U9", text: DELTA, ...thread },
    ].slice(0, upTo + 1);

  /**
   * TEST_SCENARIO: A message that tags nobody reaches no queue in a
   * mention-only channel, so the away block is the only thing that can show
   * it. If it arrives before a message that is steered into a running turn,
   * counting the steered one as the new boundary would bury it. The boundary
   * stops at the batch, and the steered message is remembered on its own.
   */
  it("shows an untagged message the boundary must not skip past", async () => {
    const UNTAGGED = "no one is tagged here";
    const gate = gatedAcp({ blockCall: 2, steerOutcome: "injected" });
    const h = harness({ makeAcp: gate.makeAcp });
    gate.hooks.answerTurn = async () => {
      await h.worker.reply("agent-1", { text: "on it", threadTs: ROOT });
    };
    h.gw.setThreadedHistory(threadedHistory(1));
    await h.worker.connect();

    await h.gw.fireMention({
      user: "U9",
      channel: BOUND,
      ts: T1,
      ...thread,
      text: ALPHA,
    });

    h.gw.setThreadedHistory(threadedHistory(2));
    const second = h.gw.fireMention({
      user: "U9",
      channel: BOUND,
      ts: T2,
      ...thread,
      text: BRAVO,
    });
    await gate.startedAt;

    h.gw.setThreadedHistory([
      ...threadedHistory(2),
      { ts: T3, user: "U7", text: UNTAGGED, ...thread },
      { ts: T4, user: "U9", text: CHARLIE, ...thread },
    ]);
    await h.gw.fireMention({
      user: "U9",
      channel: BOUND,
      ts: T4,
      ...thread,
      text: CHARLIE,
    });
    expect(gate.steers.length).toBe(1);
    gate.release();
    await second;

    h.gw.setThreadedHistory([
      ...threadedHistory(2),
      { ts: T3, user: "U7", text: UNTAGGED, ...thread },
      { ts: T4, user: "U9", text: CHARLIE, ...thread },
      { ts: "500.000000", user: "U9", text: DELTA, ...thread },
    ]);
    await h.gw.fireMention({
      user: "U9",
      channel: BOUND,
      ts: "500.000000",
      ...thread,
      text: DELTA,
    });

    const last = String(h.prompts.at(-1));
    expect(last).toContain(UNTAGGED);
    expect(last).not.toContain(CHARLIE);
  });

  /**
   * TEST_SCENARIO: A message steered into a running turn was read by the agent
   * inside that turn. Once the turn is delivered, the next turn must not show
   * it again as missed.
   */
  it("counts a message steered into a delivered turn as seen", async () => {
    const gate = gatedAcp({ blockCall: 2, steerOutcome: "injected" });
    const h = harness({ makeAcp: gate.makeAcp });
    gate.hooks.answerTurn = async () => {
      await h.worker.reply("agent-1", { text: "on it", threadTs: ROOT });
    };
    h.gw.setThreadedHistory(threadedHistory(1));
    await h.worker.connect();

    await h.gw.fireMention({
      user: "U9",
      channel: BOUND,
      ts: T1,
      ...thread,
      text: ALPHA,
    });
    expect(h.prompts.length).toBe(1);

    h.gw.setThreadedHistory(threadedHistory(2));
    const second = h.gw.fireMention({
      user: "U9",
      channel: BOUND,
      ts: T2,
      ...thread,
      text: BRAVO,
    });
    await gate.startedAt;

    h.gw.setThreadedHistory(threadedHistory(3));
    await h.gw.fireMention({
      user: "U9",
      channel: BOUND,
      ts: T3,
      ...thread,
      text: CHARLIE,
    });
    expect(gate.steers.length).toBe(1);
    expect(gate.steers[0]).toContain(CHARLIE);

    gate.release();
    await second;

    h.gw.setThreadedHistory(threadedHistory(4));
    await h.gw.fireMention({
      user: "U9",
      channel: BOUND,
      ts: T4,
      ...thread,
      text: DELTA,
    });

    const third = String(h.prompts[2]);
    expect(third).toContain(DELTA);
    expect(third).not.toContain(AWAY);
    expect(countAcross(h.prompts, CHARLIE)).toBe(0);
  });

  /**
   * TEST_SCENARIO: The boundary only advances when a turn is delivered. If the
   * turn a message was steered into fails, no one received that message, so
   * the next turn's catch-up must show both the failed batch and the steered
   * message again.
   */
  it("recovers the batch and its steered messages when the turn fails", async () => {
    const gate = gatedAcp({
      blockCall: 2,
      steerOutcome: "injected",
      failOnRelease: true,
    });
    const h = harness({ makeAcp: gate.makeAcp });
    gate.hooks.answerTurn = async () => {
      await h.worker.reply("agent-1", { text: "on it", threadTs: ROOT });
    };
    h.gw.setThreadedHistory(threadedHistory(1));
    await h.worker.connect();

    await h.gw.fireMention({
      user: "U9",
      channel: BOUND,
      ts: T1,
      ...thread,
      text: ALPHA,
    });
    expect(h.prompts.length).toBe(1);

    h.gw.setThreadedHistory(threadedHistory(2));
    const second = h.gw.fireMention({
      user: "U9",
      channel: BOUND,
      ts: T2,
      ...thread,
      text: BRAVO,
    });
    await gate.startedAt;

    h.gw.setThreadedHistory(threadedHistory(3));
    await h.gw.fireMention({
      user: "U9",
      channel: BOUND,
      ts: T3,
      ...thread,
      text: CHARLIE,
    });
    gate.release();
    await second;

    h.gw.setThreadedHistory(threadedHistory(4));
    await h.gw.fireMention({
      user: "U9",
      channel: BOUND,
      ts: T4,
      ...thread,
      text: DELTA,
    });

    const recovered = h.prompts.map(String).find((p) => p.includes(DELTA));
    expect(recovered).toBeDefined();
    expect(recovered).toContain(AWAY);
    expect(recovered).toContain(BRAVO);
    expect(recovered).toContain(CHARLIE);
  });
});

describe("selectUnseen bounds", () => {
  const entry = (ts: string): ThreadEntry<string> => ({
    ts,
    authorAgentId: null,
    message: ts,
  });

  /**
   * TEST_SCENARIO: Only messages between the boundary and the delivered batch
   * are a gap. Messages at or below the boundary were seen before, messages
   * above the batch are still to be delivered, and the batch itself is already
   * in the turn's own text.
   */
  it("keeps the gap and drops the boundary, the batch, and the future", () => {
    const picked = selectUnseen(
      [entry("100.1"), entry("100.2"), entry("100.3"), entry("100.4")],
      {
        readingAgentId: "agent-1",
        since: "100.1",
        until: "100.3",
        carried: ["100.3"],
      },
    );
    expect(picked.map((e) => e.ts)).toEqual(["100.2"]);
  });
});
