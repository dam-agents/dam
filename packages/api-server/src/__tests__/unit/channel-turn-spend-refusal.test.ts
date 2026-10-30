// TEST_OVERVIEW: a Slack or Telegram turn that a spend limit or the ceiling stops partway is classed as a spend stop, not a generic relay failure, so the thread gets the notice a held turn gets.
import { describe, expect, it } from "vitest";

import { classifyTurnFailure } from "../../modules/channels/infrastructure/turn-failure-copy.js";
import {
  CEILING_TEXT,
  softLimitText,
} from "../../modules/spend/domain/refusal.js";

describe("channel turn stopped by spend", () => {
  // TEST_SCENARIO: the harness reports the gate's refusal while it sets the session's model; the failure is a spend stop by a limit.
  it("names a reached spend limit", () => {
    expect(
      classifyTurnFailure(
        new Error(
          `The harness refused the session's model: API error: 429 ${softLimitText("DAM")} · model not changed`,
        ),
      ),
    ).toEqual({ kind: "spend", reason: "spend-limit", block: "limit" });
  });

  // TEST_SCENARIO: the ceiling's refusal names the platform operator; the failure is a spend stop by the ceiling.
  it("names the spend ceiling", () => {
    expect(
      classifyTurnFailure(new Error(`API error: 429 ${CEILING_TEXT}`)),
    ).toEqual({ kind: "spend", reason: "spend-ceiling", block: "ceiling" });
  });
});
