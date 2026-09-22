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
 * catch-up. The away block must cover only messages the conversation's session
 * would otherwise never receive: nothing queued for its own turn may appear in
 * it, a delivered batch advances the boundary to its newest send-ts whatever
 * order Slack delivered it in, a message steered into a delivered turn counts
 * as seen, and a turn that failed leaves the boundary alone so its messages
 * are recovered by the next turn's catch-up.
 */
const harness = (
  opts: Parameters<typeof slackWorkerHarness>[0] = {},
): ReturnType<typeof slackWorkerHarness> =>
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
   * TEST_SCENARIO: A message already visible in channel history but queued for
   * its own later turn is the future, not a gap. The turn answering the
   * earlier message must not present it as missed — it arrives untainted as
   * the next turn, and no prompt carries the away legend.
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
   * TEST_SCENARIO: An agent that was genuinely away — events never delivered,
   * no turn carried them — still gets the gap under the away legend. The
   * bounds added for live traffic must not eat the rescue.
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
   * TEST_SCENARIO: A message steered into a running turn was read by the agent
   * inside that turn. Once the turn is delivered, the boundary covers it — the
   * next turn must not re-present it as missed.
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
   * TEST_SCENARIO: The boundary only advances with a delivered turn. When the
   * turn a message was steered into dies, that message reached nobody — the
   * next turn's catch-up must bring back both the failed batch and what was
   * steered into it.
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
   * TEST_SCENARIO: The selection window is (since, until]: what the boundary
   * already covers stays out, what was sent after the delivered batch stays
   * out, and the batch itself is carried by the turn rather than the gap.
   */
  it("keeps the gap and drops the boundary, the batch, and the future", () => {
    const picked = selectUnseen(
      [entry("100.1"), entry("100.2"), entry("100.3"), entry("100.4")],
      {
        readingAgentId: "agent-1",
        since: "100.1",
        triggeringTs: "100.3",
        until: "100.3",
        batchTs: ["100.3"],
      },
    );
    expect(picked.map((e) => e.ts)).toEqual(["100.2"]);
  });
});
