import { describe, expect, test } from "vitest";

import { QUEUE_FULL_DESCRIPTION } from "../../modules/acp/errors.js";
import { QUEUED_LOST_MESSAGE } from "../../modules/acp/session-projection.js";
import {
  classifySendOutcome,
  type SendFailureFacts,
} from "../../modules/sessions/lib/send-outcome.js";

const BASE: SendFailureFacts = {
  connectionClosed: false,
  delivered: false,
  queued: false,
  queueFull: false,
  closeReason: null,
  errorMessage: "boom",
};

const facts = (over: Partial<SendFailureFacts>): SendFailureFacts => ({
  ...BASE,
  ...over,
});

describe("classifySendOutcome", () => {
  test("a full queue is reported in the user's terms", () => {
    expect(classifySendOutcome(facts({ queueFull: true }))).toEqual({
      report: true,
      message: QUEUE_FULL_DESCRIPTION.message,
    });
  });

  test("an agent-side rejection reports its own message", () => {
    expect(classifySendOutcome(facts({}))).toEqual({
      report: true,
      message: "boom",
    });
  });

  test("a drop before delivery is a real loss", () => {
    const outcome = classifySendOutcome(facts({ connectionClosed: true }));
    expect(outcome).toMatchObject({ report: true });
    if (outcome.report) expect(outcome.message).toMatch(/dropped before/);
  });

  test("a stated close reason reaches the user", () => {
    const outcome = classifySendOutcome(
      facts({ connectionClosed: true, closeReason: "agent exited" }),
    );
    expect(outcome).toMatchObject({ report: true });
    if (outcome.report) expect(outcome.message).toContain("agent exited");
  });

  test("a queued prompt is lost when its channel goes", () => {
    expect(
      classifySendOutcome(
        facts({ connectionClosed: true, delivered: true, queued: true }),
      ),
    ).toEqual({ report: true, message: QUEUED_LOST_MESSAGE });
  });

  test("a delivered turn keeps running, so a drop reports nothing", () => {
    expect(
      classifySendOutcome(facts({ connectionClosed: true, delivered: true })),
    ).toEqual({ report: false });
  });
});
