import { describe, expect, it } from "vitest";

import { turnIndexForReply } from "../../modules/timeline/lib/align-turns.js";

/**
 * TEST_OVERVIEW: the rule that puts a turn's telemetry under the right reply
 * when the two counts disagree, which they do whenever the harness skipped a
 * prompt event and two replies merged into one turn.
 */

const alignAll = (turnCount: number, replyCount: number) =>
  Array.from({ length: replyCount }, (_, i) =>
    turnIndexForReply(turnCount, replyCount, i),
  );

describe("turnIndexForReply", () => {
  it("maps one-to-one when the counts agree", () => {
    expect(alignAll(3, 3)).toEqual([0, 1, 2]);
  });

  it("keeps the newest reply correct when a turn is missing", () => {
    /**
     * TEST_SCENARIO: the bug this exists for — mapping from the start gave the
     * newest reply nothing and shifted every other reply onto the following
     * turn's telemetry, so a reply only looked right once another was sent.
     */
    expect(alignAll(4, 5)).toEqual([null, 0, 1, 2, 3]);
  });

  it("leaves every reply unlabelled when no turns have landed", () => {
    expect(alignAll(0, 2)).toEqual([null, null]);
  });

  it("drops the oldest turns rather than the newest when turns outnumber replies", () => {
    /**
     * TEST_SCENARIO: the window holds turns from before the loaded transcript,
     * so the extra ones belong off the top of the page, not to a reply.
     */
    expect(alignAll(5, 2)).toEqual([3, 4]);
  });

  it("refuses an index outside the reply range", () => {
    expect(turnIndexForReply(3, 3, -1)).toBeNull();
    expect(turnIndexForReply(3, 3, 3)).toBeNull();
  });

  it("gives the single reply the single turn", () => {
    expect(alignAll(1, 1)).toEqual([0]);
  });
});
