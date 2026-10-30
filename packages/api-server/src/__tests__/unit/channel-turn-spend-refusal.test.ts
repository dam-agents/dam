// TEST_OVERVIEW: a Slack or Telegram turn that a spend limit or the ceiling stops partway tells the thread why, with the same words as a turn the limit holds before it starts, instead of a generic relay failure.
import { describe, expect, it } from "vitest";

import { classifyTurnFailure } from "../../modules/channels/infrastructure/turn-failure-copy.js";
import {
  CEILING_TEXT,
  softLimitText,
} from "../../modules/spend/domain/refusal.js";

const ctx = {
  uiBaseUrl: "https://dam.example",
  agentId: "agent-1",
  threads: true,
  brandName: "DAM",
  resetAt: "00:00 UTC",
};

describe("channel turn stopped by spend", () => {
  // TEST_SCENARIO: the harness reports the gate's refusal while it sets the session's model; the thread hears that the agent reached its spend limit and when it answers again.
  it("names a reached spend limit", () => {
    const failure = classifyTurnFailure(
      new Error(
        `The harness refused the session's model: API error: 429 ${softLimitText("DAM")} · model not changed`,
      ),
    );
    expect(failure.reason).toBe("spend-limit");
    if (failure.kind !== "plain") throw new Error("expected plain copy");
    expect(failure.copy(ctx)).toContain("reached its spend limit for today");
    expect(failure.copy(ctx)).toContain("00:00 UTC");
  });

  // TEST_SCENARIO: the ceiling's refusal names the platform operator; the thread hears about the owner's spend ceiling.
  it("names the spend ceiling", () => {
    const failure = classifyTurnFailure(
      new Error(`API error: 429 ${CEILING_TEXT}`),
    );
    expect(failure.reason).toBe("spend-ceiling");
    if (failure.kind !== "plain") throw new Error("expected plain copy");
    expect(failure.copy(ctx)).toContain("spend ceiling");
  });
});
