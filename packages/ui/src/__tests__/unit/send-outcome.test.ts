import { AGENT_STOP_CLOSE_REASONS } from "api-server-api";
import { describe, expect, test } from "vitest";

import { QUEUE_FULL_DESCRIPTION } from "../../modules/acp/errors.js";
import { QUEUED_LOST_MESSAGE } from "../../modules/acp/session-projection.js";
import {
  classifySendOutcome,
  type SendFailureFacts,
} from "../../modules/sessions/lib/send-outcome.js";

/** A send that failed with the agent answering, nothing else true. */
const BASE: SendFailureFacts = {
  connectionClosed: false,
  delivered: false,
  queued: false,
  sessionMissing: false,
  queueFull: false,
  closeReason: null,
  errorMessage: "boom",
};

const facts = (over: Partial<SendFailureFacts>): SendFailureFacts => ({
  ...BASE,
  ...over,
});

describe("classifySendOutcome", () => {
  const cases: ReadonlyArray<
    [name: string, facts: SendFailureFacts, report: boolean, retry?: boolean]
  > = [
    [
      "a session the agent no longer has is reported and not retryable",
      facts({ sessionMissing: true }),
      true,
      false,
    ],
    [
      "a full queue is reported and retryable",
      facts({ queueFull: true }),
      true,
      true,
    ],
    ["an agent-side rejection reports its own message", facts({}), true, true],
    [
      "a drop before delivery is a real loss",
      facts({ connectionClosed: true }),
      true,
      true,
    ],
    [
      "a queued prompt is lost when its channel goes",
      facts({ connectionClosed: true, delivered: true, queued: true }),
      true,
      true,
    ],
    [
      "a delivered turn closed by an agent stop is reported lost",
      facts({
        connectionClosed: true,
        delivered: true,
        closeReason: AGENT_STOP_CLOSE_REASONS[0],
      }),
      true,
      true,
    ],
    [
      "a delivered turn closed without a reason keeps running, so nothing is reported",
      facts({ connectionClosed: true, delivered: true }),
      false,
    ],
    [
      "a relay-substituted reason is not evidence of a stop",
      facts({
        connectionClosed: true,
        delivered: true,
        closeReason: "upstream closed",
      }),
      false,
    ],
  ];

  for (const [name, given, report, retry] of cases) {
    test(name, () => {
      const outcome = classifySendOutcome(given);
      expect(outcome.report).toBe(report);
      if (outcome.report) expect(outcome.retry).toBe(retry);
    });
  }

  test("each branch renders its own wording", () => {
    expect(classifySendOutcome(facts({ queueFull: true }))).toMatchObject({
      message: QUEUE_FULL_DESCRIPTION.message,
    });
    expect(
      classifySendOutcome(
        facts({ connectionClosed: true, delivered: true, queued: true }),
      ),
    ).toMatchObject({ message: QUEUED_LOST_MESSAGE });
    expect(classifySendOutcome(facts({}))).toMatchObject({ message: "boom" });
  });

  test("a stated close reason reaches the user in both wordings", () => {
    const undelivered = classifySendOutcome(
      facts({ connectionClosed: true, closeReason: "upstream closed" }),
    );
    expect(undelivered).toMatchObject({ report: true });
    if (undelivered.report)
      expect(undelivered.message).toContain("upstream closed");

    const stopped = classifySendOutcome(
      facts({
        connectionClosed: true,
        delivered: true,
        closeReason: AGENT_STOP_CLOSE_REASONS[1],
      }),
    );
    expect(stopped).toMatchObject({ report: true });
    if (stopped.report)
      expect(stopped.message).toContain(AGENT_STOP_CLOSE_REASONS[1]);
  });
});
