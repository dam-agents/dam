import { describe, expect, test } from "vitest";

import {
  describeSendError,
  extractErrorMessage,
  unstoredSessionPrompts,
} from "../../modules/acp/errors.js";

describe("send-error surfacing", () => {
  test("JSON-RPC internal error is replaced by data.details", () => {
    expect(
      extractErrorMessage({
        code: -32603,
        message: "Internal error",
        data: { details: "API error: 402 Payment Required" },
      }),
    ).toBe("API error: 402 Payment Required");
  });

  test("billing failures get an actionable hint", () => {
    const { message, hint } = describeSendError(
      "API error: 402 Payment Required",
    );
    expect(message).toBe("API error: 402 Payment Required");
    expect(hint).toMatch(/billing/i);
  });

  // TEST_SCENARIO: the release refuses a run whose agent has no saved model. The old chat says where that model is picked and offers the way there, instead of leaving the router's sentence alone.
  test("a session with no model points at the agent's model control", () => {
    const { hint, needsModel } = describeSendError(
      "This session has no model. Pick one for it, or set the agent's default model on its Providers page.",
    );
    expect(needsModel).toBe(true);
    expect(hint).toMatch(/agent's settings/i);
  });

  test("bare internal error is rewritten to say where to look", () => {
    const { message, hint } = describeSendError("Internal error");
    expect(message).not.toMatch(/internal error/i);
    expect(hint).toMatch(/session log/i);
  });
});

describe("an unstored session", () => {
  // TEST_SCENARIO: the runtime refuses to load a session the harness never stored and carries the prompts it kept on the error, so the chat can move them into a new chat instead of losing them.
  test("its kept prompts are read from the load error", () => {
    const prompt = {
      id: "p1",
      recordedAt: "2026-10-26T10:00:00Z",
      blocks: [{ type: "text" as const, text: "do the thing" }],
      droppedAttachments: [],
      reason: "undelivered",
    };
    expect(
      unstoredSessionPrompts({
        code: -32000,
        message: "This session was never stored",
        data: { platform: { unstored: true, undelivered: [prompt] } },
      }),
    ).toEqual([prompt]);
    expect(unstoredSessionPrompts({ code: -32000, message: "other" })).toBe(
      null,
    );
  });
});
