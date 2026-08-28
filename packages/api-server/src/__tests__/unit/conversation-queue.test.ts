import { describe, it, expect } from "vitest";
import {
  createConversationQueue,
  type SteerResult,
} from "../../modules/channels/infrastructure/conversation-queue.js";

/**
 * TEST_OVERVIEW: The queue both channel workers run a conversation through. It
 * holds arriving messages for a quiet period so a burst becomes one turn,
 * steers anything that lands while a turn is running into that turn, and falls
 * back to a following turn where the harness refuses to be steered. It runs one
 * turn at a time and never reorders what people sent.
 */

type Msg = { id: string; heavy?: boolean };

const tick = () => new Promise((r) => setTimeout(r, 0));
const settleFor = (ms: number) => new Promise((r) => setTimeout(r, ms * 8));

function spyQueue(opts: {
  settleMs?: number;
  steerResult?: SteerResult;
  canSteer?: (m: Msg) => boolean;
  hold?: boolean;
  slowSteer?: boolean;
}) {
  const turns: string[][] = [];
  const steers: string[][] = [];
  const steered: string[][] = [];
  const settled: string[][] = [];
  const gates: Array<() => void> = [];
  const steerGates: Array<() => void> = [];
  let holdSteers = opts.slowSteer ?? false;
  let live = 0;
  let peak = 0;

  const queue = createConversationQueue<Msg>({
    settleMs: opts.settleMs ?? 0,
    ...(opts.canSteer ? { canSteer: opts.canSteer } : {}),
    runTurn: async (batch, onSession) => {
      turns.push(batch.map((m) => m.id));
      onSession("sess-1");
      if (opts.hold) await new Promise<void>((r) => gates.push(r));
    },
    steer: async (_sessionId, batch) => {
      steers.push(batch.map((m) => m.id));
      live += 1;
      peak = Math.max(peak, live);
      try {
        if (holdSteers) await new Promise<void>((r) => steerGates.push(r));
        return opts.steerResult ?? "refused";
      } finally {
        live -= 1;
      }
    },
    onSteered: (batch) => steered.push(batch.map((m) => m.id)),
    onTurnSettled: (batch) => settled.push(batch.map((m) => m.id)),
  });

  return {
    queue,
    turns,
    steers,
    steered,
    settled,
    releaseAll() {
      for (const g of gates) g();
      gates.length = 0;
    },
    releaseSteers() {
      holdSteers = false;
      for (const g of steerGates) g();
      steerGates.length = 0;
    },
    peakConcurrentSteers: () => peak,
    async waitFor(done: () => boolean) {
      for (let i = 0; i < 400 && !done(); i++) await tick();
    },
  };
}

describe("createConversationQueue", () => {
  /**
   * TEST_SCENARIO: The reported bug. Messages sent in quick succession must be
   * answered together, so the quiet period gathers them into one turn.
   */
  it("gathers a burst into one turn during the quiet period", async () => {
    const h = spyQueue({ settleMs: 2 });

    const a = h.queue.submit({ id: "a" });
    await tick();
    const b = h.queue.submit({ id: "b" });
    await tick();
    const c = h.queue.submit({ id: "c" });
    await Promise.all([a, b, c]);

    expect(h.turns).toEqual([["a", "b", "c"]]);
  });

  /**
   * TEST_SCENARIO: With no quiet period configured the first message starts a
   * turn straight away — the surface that wants latency over batching keeps it.
   */
  it("starts immediately when no quiet period is set", async () => {
    const h = spyQueue({ settleMs: 0 });
    await h.queue.submit({ id: "a" });
    expect(h.turns).toEqual([["a"]]);
  });

  /**
   * TEST_SCENARIO: A message arriving mid-turn reaches the agent through the
   * running turn, so the conversation is still answered once.
   */
  it("steers a mid-turn arrival into the running turn", async () => {
    const h = spyQueue({ hold: true, steerResult: "injected" });

    void h.queue.submit({ id: "a" });
    await h.waitFor(() => h.turns.length === 1);

    void h.queue.submit({ id: "b" });
    await h.waitFor(() => h.steers.length === 1);

    expect(h.steers).toEqual([["b"]]);
    h.releaseAll();
    await h.waitFor(() => h.settled.length === 1);
    expect(h.turns).toEqual([["a"]]);
  });

  /**
   * TEST_SCENARIO: Where the harness refuses steering the message must still be
   * answered, as the next turn — never as a second turn racing the first.
   */
  it("runs a refused steer as the following turn", async () => {
    const h = spyQueue({ hold: true, steerResult: "refused" });

    void h.queue.submit({ id: "a" });
    await h.waitFor(() => h.turns.length === 1);

    void h.queue.submit({ id: "b" });
    await h.waitFor(() => h.steers.length === 1);
    expect(h.turns).toEqual([["a"]]);

    h.releaseAll();
    await h.waitFor(() => h.turns.length === 2);
    expect(h.turns).toEqual([["a"], ["b"]]);
  });

  /**
   * TEST_SCENARIO: Attachments travel with the turn that carries them, so a
   * message holding one cannot be steered — and it must block the messages
   * behind it rather than let them overtake it.
   */
  it("never steers past a message it cannot steer", async () => {
    const h = spyQueue({
      hold: true,
      steerResult: "injected" as const,
      canSteer: (m) => m.heavy !== true,
    });

    void h.queue.submit({ id: "a" });
    await h.waitFor(() => h.turns.length === 1);

    void h.queue.submit({ id: "withFile", heavy: true });
    void h.queue.submit({ id: "c" });
    await h.waitFor(() => h.steers.length > 0);

    expect(h.steers).toEqual([]);

    h.releaseAll();
    await h.waitFor(() => h.turns.length === 2);
    expect(h.turns[1]).toEqual(["withFile", "c"]);
  });

  /**
   * TEST_SCENARIO: A turn that throws must not wedge the conversation — the
   * messages queued behind it still get their turn.
   */
  it("keeps draining after a turn fails", async () => {
    const turns: string[][] = [];
    let fail = true;
    const queue = createConversationQueue<Msg>({
      settleMs: 0,
      runTurn: async (batch) => {
        turns.push(batch.map((m) => m.id));
        if (fail) {
          fail = false;
          throw new Error("boom");
        }
      },
      steer: async () => "refused" as const,
      onError: () => {},
    });

    await queue.submit({ id: "a" });
    await queue.submit({ id: "b" });

    expect(turns).toEqual([["a"], ["b"]]);
  });

  /**
   * TEST_SCENARIO: A steer is a round trip, and someone can send another
   * message inside it. The batch already on its way must not be planned a
   * second time, or the agent is handed the same message twice.
   */
  it("does not re-steer a batch when a message arrives inside the round trip", async () => {
    const h = spyQueue({
      hold: true,
      slowSteer: true,
      steerResult: "injected",
    });

    void h.queue.submit({ id: "a" });
    await h.waitFor(() => h.turns.length === 1);

    void h.queue.submit({ id: "b" });
    await h.waitFor(() => h.steers.length === 1);

    void h.queue.submit({ id: "c" });
    await h.waitFor(() => h.steers.length > 1);
    expect(h.steers).toEqual([["b"]]);

    h.releaseSteers();
    await h.waitFor(() => h.steered.length === 2);
    expect(h.steers).toEqual([["b"], ["c"]]);
    expect(h.steered).toEqual([["b"], ["c"]]);
  });

  /**
   * TEST_SCENARIO: Every arrival used to start its own steer, so a burst opened
   * one connection per message and their answers came back interleaved. One
   * steer runs at a time and takes whatever has gathered behind it.
   */
  it("runs one steer at a time and gathers the rest behind it", async () => {
    const h = spyQueue({
      hold: true,
      slowSteer: true,
      steerResult: "injected",
    });

    void h.queue.submit({ id: "a" });
    await h.waitFor(() => h.turns.length === 1);

    for (const id of ["b", "c", "d", "e", "f"]) void h.queue.submit({ id });
    await h.waitFor(() => h.steers.length > 1);

    expect(h.peakConcurrentSteers()).toBe(1);
    expect(h.steers).toEqual([["b"]]);

    h.releaseSteers();
    await h.waitFor(() => h.steered.flat().length === 5);

    expect(h.peakConcurrentSteers()).toBe(1);
    expect(h.steered.flat()).toEqual(["b", "c", "d", "e", "f"]);
  });

  /**
   * TEST_SCENARIO: A batch the harness refused goes back ahead of whatever was
   * sent after it. Losing its place would hand the agent a split thought in the
   * wrong order, which is the failure this queue exists to prevent.
   */
  it("keeps a refused batch ahead of what arrived after it", async () => {
    const h = spyQueue({ hold: true, slowSteer: true, steerResult: "refused" });

    void h.queue.submit({ id: "a" });
    await h.waitFor(() => h.turns.length === 1);

    void h.queue.submit({ id: "b" });
    await h.waitFor(() => h.steers.length === 1);

    void h.queue.submit({ id: "c" });
    h.releaseSteers();
    await h.waitFor(() => h.steers.length > 1);

    h.releaseAll();
    await h.waitFor(() => h.turns.length === 2);

    expect(h.turns[1]).toEqual(["b", "c"]);
  });

  /**
   * TEST_SCENARIO: A turn can end while a steer is still in flight. The message
   * must be delivered once — the queue may not both inject it into the turn
   * that just ended and run it again as the next turn.
   */
  it("delivers once when the turn ends during a steer", async () => {
    const h = spyQueue({
      hold: true,
      slowSteer: true,
      steerResult: "injected",
    });

    void h.queue.submit({ id: "a" });
    await h.waitFor(() => h.turns.length === 1);

    void h.queue.submit({ id: "b" });
    await h.waitFor(() => h.steers.length === 1);

    h.releaseAll();
    await h.waitFor(() => h.settled.length === 1);
    expect(h.turns).toEqual([["a"]]);

    h.releaseSteers();
    await h.waitFor(() => h.turns.length === 2);

    expect(h.steered).toEqual([]);
    expect(h.turns).toEqual([["a"], ["b"]]);
  });

  /**
   * TEST_SCENARIO: Whether a harness can be steered is a fact about the
   * harness, not about one message, so it is asked once — every later arrival
   * on that turn waits instead of opening another connection to be refused.
   */
  it("asks an unsupported harness only once", async () => {
    const h = spyQueue({ hold: true, steerResult: "unsupported" });

    void h.queue.submit({ id: "a" });
    await h.waitFor(() => h.turns.length === 1);

    void h.queue.submit({ id: "b" });
    await h.waitFor(() => h.steers.length === 1);
    void h.queue.submit({ id: "c" });
    void h.queue.submit({ id: "d" });
    await h.waitFor(() => h.steers.length > 1);

    expect(h.steers).toEqual([["b"]]);

    h.releaseAll();
    await h.waitFor(() => h.turns.length === 2);
    expect(h.turns[1]).toEqual(["b", "c", "d"]);
  });

  /**
   * TEST_SCENARIO: The quiet period cannot be extended for ever by someone who
   * keeps typing — it stops after a bounded number of rounds and answers.
   */
  it("stops waiting once the quiet period has been extended enough", async () => {
    const h = spyQueue({ settleMs: 1 });
    let stop = false;
    let n = 0;

    const keepTyping = (async () => {
      while (!stop && n < 40) {
        void h.queue.submit({ id: `m${n++}` });
        await tick();
      }
    })();

    await h.waitFor(() => h.turns.length > 0);
    stop = true;
    await keepTyping;
    await settleFor(2);

    expect(h.turns.length).toBeGreaterThan(0);
  });
});
