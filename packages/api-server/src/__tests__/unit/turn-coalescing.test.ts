import { describe, it, expect } from "vitest";
import {
  planCoalescedDelivery,
  DEFAULT_MAX_COALESCED_BATCH,
} from "../../modules/channels/domain/turn-coalescing.js";

// TEST_OVERVIEW: The rule both channel workers share for turning queued
// messages into turns. With no turn running the whole queue becomes one turn,
// so a burst is answered once instead of once per message. With a turn running
// the messages join it by steering, but only a leading run of them — a message
// the caller cannot steer stops the run so nothing is reordered — and where
// steering is unavailable they wait and become the next turn. Every batch is
// capped, and the overflow stays queued.

type Msg = { id: string; steerable?: boolean };

const msg = (id: string, steerable = true): Msg => ({ id, steerable });
const ids = (batch: Msg[]) => batch.map((m) => m.id);

describe("planCoalescedDelivery", () => {
  // TEST_SCENARIO: Nothing queued means there is nothing to do, whether or not
  // a turn happens to be running.
  it("holds when the queue is empty", () => {
    expect(
      planCoalescedDelivery<Msg>({
        pending: [],
        turnInFlight: false,
        steerable: false,
      }),
    ).toEqual({ kind: "hold" });
  });

  // TEST_SCENARIO: The burst case from the bug: several messages waiting with
  // no turn running become a single turn carrying all of them.
  it("starts one turn carrying every queued message", () => {
    const plan = planCoalescedDelivery({
      pending: [msg("a"), msg("b"), msg("c")],
      turnInFlight: false,
      steerable: false,
    });

    expect(plan.kind).toBe("start");
    if (plan.kind !== "start") return;
    expect(ids(plan.batch)).toEqual(["a", "b", "c"]);
    expect(plan.remaining).toEqual([]);
  });

  // TEST_SCENARIO: A message arriving mid-turn joins the running turn where the
  // harness accepts steering, so the agent reads it before it replies.
  it("steers into a running turn when the harness supports it", () => {
    const plan = planCoalescedDelivery({
      pending: [msg("a"), msg("b")],
      turnInFlight: true,
      steerable: true,
    });

    expect(plan.kind).toBe("steer");
    if (plan.kind !== "steer") return;
    expect(ids(plan.batch)).toEqual(["a", "b"]);
  });

  // TEST_SCENARIO: Where the harness cannot be steered the messages must wait
  // rather than start a second turn alongside the first.
  it("holds a mid-turn arrival when steering is unavailable", () => {
    expect(
      planCoalescedDelivery({
        pending: [msg("a")],
        turnInFlight: true,
        steerable: false,
      }),
    ).toEqual({ kind: "hold" });
  });

  // TEST_SCENARIO: Attachments reach the agent through the turn's own delivery
  // path, so a message carrying them cannot be steered — and it stops the run
  // so later messages never overtake it.
  it("steers only the leading run of steerable messages", () => {
    const plan = planCoalescedDelivery({
      pending: [msg("a"), msg("withFile", false), msg("c")],
      turnInFlight: true,
      steerable: true,
      canSteer: (m) => m.steerable === true,
    });

    expect(plan.kind).toBe("steer");
    if (plan.kind !== "steer") return;
    expect(ids(plan.batch)).toEqual(["a"]);
    expect(ids(plan.remaining)).toEqual(["withFile", "c"]);
  });

  // TEST_SCENARIO: When the message at the head cannot be steered there is
  // nothing to inject, so the queue waits for the turn to end.
  it("holds when the head of the queue cannot be steered", () => {
    expect(
      planCoalescedDelivery({
        pending: [msg("withFile", false), msg("b")],
        turnInFlight: true,
        steerable: true,
        canSteer: (m) => m.steerable === true,
      }),
    ).toEqual({ kind: "hold" });
  });

  // TEST_SCENARIO: One turn must not carry an unbounded prompt, so the batch is
  // capped and the rest stays queued for the turn after.
  it("caps a batch and leaves the overflow queued", () => {
    const plan = planCoalescedDelivery({
      pending: [msg("a"), msg("b"), msg("c")],
      turnInFlight: false,
      steerable: false,
      maxBatch: 2,
    });

    expect(plan.kind).toBe("start");
    if (plan.kind !== "start") return;
    expect(ids(plan.batch)).toEqual(["a", "b"]);
    expect(ids(plan.remaining)).toEqual(["c"]);
  });

  // TEST_SCENARIO: A cap below one would starve the queue, so it is floored at
  // one message per turn.
  it("always releases at least one message", () => {
    const plan = planCoalescedDelivery({
      pending: [msg("a"), msg("b")],
      turnInFlight: false,
      steerable: false,
      maxBatch: 0,
    });

    expect(plan.kind).toBe("start");
    if (plan.kind !== "start") return;
    expect(ids(plan.batch)).toEqual(["a"]);
  });

  // TEST_SCENARIO: The default cap applies when no caller states one.
  it("caps at the default when none is given", () => {
    const pending = Array.from(
      { length: DEFAULT_MAX_COALESCED_BATCH + 3 },
      (_, i) => msg(`m${i}`),
    );
    const plan = planCoalescedDelivery({
      pending,
      turnInFlight: false,
      steerable: false,
    });

    expect(plan.kind).toBe("start");
    if (plan.kind !== "start") return;
    expect(plan.batch).toHaveLength(DEFAULT_MAX_COALESCED_BATCH);
    expect(plan.remaining).toHaveLength(3);
  });
});
