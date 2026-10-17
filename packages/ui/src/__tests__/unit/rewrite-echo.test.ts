import { describe, expect, test } from "vitest";

import { applyUpdate } from "../../modules/acp/session-projection.js";
import type { AcpUpdate } from "../../modules/acp/types.js";
import { rewrittenThread } from "../../modules/sessions/lib/rewrite-messages.js";
import { setupMessageOf } from "../../modules/sessions/lib/thread-items.js";
import type { Message } from "../../types.js";

// TEST_OVERVIEW: a fork or rewind shows its new prompt at once, then the runtime echoes that prompt back; the bubble must show the text once (CHAT-8). An initialization session's first prompt is the kit briefing, shown as a setup card rather than a user bubble.

const user = (id: string, text: string): Message => ({
  id,
  role: "user",
  parts: [{ kind: "text", text }],
  streaming: false,
});

describe("rewrittenThread", () => {
  /**
   * TEST_SCENARIO: Fork and send, then the runtime's echo of the same prompt
   * arrives under the prompt's id. The bubble keeps one copy of the text.
   */
  test("the echo of a forked prompt does not duplicate its text", () => {
    const prev = [user("m1", "first"), user("m2", "old text")];
    const thread = rewrittenThread(prev, 1, "p1", [
      { kind: "text", text: "new text" },
    ]);
    expect(thread.map((m) => m.id).slice(0, 2)).toEqual(["m1", "p1"]);
    const echoed = applyUpdate(thread, {
      sessionUpdate: "user_message_chunk",
      messageId: "p1",
      content: { type: "text", text: "new text" },
    } as AcpUpdate);
    expect(echoed.find((m) => m.id === "p1")!.parts).toEqual([
      { kind: "text", text: "new text" },
    ]);
  });
});

describe("setupMessageOf", () => {
  /**
   * TEST_SCENARIO: The briefing is the first message of the session; a
   * session that opens with a notice or the agent has no briefing to fold.
   */
  test("names only a leading user message", () => {
    expect(setupMessageOf([user("b", "brief"), user("u", "hi")])).toBe("b");
    expect(
      setupMessageOf([{ ...user("n", "older"), notice: true }]),
    ).toBeUndefined();
    expect(
      setupMessageOf([{ ...user("a", "hi"), role: "assistant" }]),
    ).toBeUndefined();
    expect(setupMessageOf([])).toBeUndefined();
  });
});
