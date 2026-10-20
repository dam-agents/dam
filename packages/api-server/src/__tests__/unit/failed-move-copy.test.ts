// TEST_OVERVIEW: a move that failed is described in two places here — the
// TEST_OVERVIEW: sentence a refused wake carries, and the answer a channel
// TEST_OVERVIEW: sends instead of waiting — and both must name an operator as the
// TEST_OVERVIEW: one who ends it. The owner can start and stop nothing, so a
// TEST_OVERVIEW: sentence that asks the owner to retry or abort sends them looking
// TEST_OVERVIEW: for a control that no page offers.
import { describe, expect, it } from "vitest";

import { describeWakeFailure } from "../../modules/agents/domain/wake-failure.js";
import { wakeFailureUserCopy } from "../../modules/channels/infrastructure/wake-failure-copy.js";

const OPERATOR = "operator";

describe("the failed-move copy", () => {
  // TEST_SCENARIO: both sentences say the move failed and that an operator finishes or undoes it, and neither hands the recovery to the owner.
  it("names the operator as the one who ends a failed move", () => {
    for (const sentence of [
      describeWakeFailure({ kind: "migration-failed" }),
      wakeFailureUserCopy({ kind: "migration-failed" }),
    ]) {
      expect(sentence).toContain(OPERATOR);
      expect(sentence).toMatch(/finishes or undoes the move/);
      expect(sentence).not.toMatch(/its owner|retry or abort/);
    }
  });
});
