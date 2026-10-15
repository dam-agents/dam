import { describe, expect, test } from "vitest";

import { rewritePointsOf } from "../../modules/acp/session-projection.js";
import type { Message } from "../../types.js";

/**
 * TEST_OVERVIEW: Which user messages offer rewind and fork, and the cut the
 * client suggests for each.
 *
 * The runtime finds the real cut in the agent's own history; the client's cut
 * is only the fallback for an agent without one. Every sent message is a
 * starting point, a steered one too. The fallback names the reply right above
 * the message, null only when nothing is above it, and nothing when what is
 * above it is another message or older history that is not loaded.
 */

function user(id: string, extra: Partial<Message> = {}): Message {
  return {
    id,
    role: "user",
    parts: [{ kind: "text", text: id }],
    streaming: false,
    ...extra,
  };
}

function reply(id: string, lastMessageId?: string): Message {
  return {
    id,
    role: "assistant",
    parts: [{ kind: "text", text: id }],
    streaming: false,
    ...(lastMessageId && { lastMessageId }),
  };
}

describe("rewritePointsOf", () => {
  /**
   * TEST_SCENARIO: Every sent message is a starting point, a steered one too;
   * a queued or failed one is not. The fallback names the reply above, and
   * null — an empty session — only for the first message: a steered message
   * with no reply above it falls back to nothing, since null there lost the
   * first message.
   */
  test("falls back to the reply above, and null only for the first message", () => {
    const points = rewritePointsOf([
      user("first"),
      user("steered", { steered: true }),
      reply("r1", "msg_1"),
      user("second"),
      user("queued", { queued: true }),
      user("failed", { error: { message: "not delivered" } }),
    ]);

    expect([...points.keys()]).toEqual(["first", "steered", "second"]);
    expect(points.get("first")).toBeNull();
    expect(points.get("steered")).toBeUndefined();
    expect(points.get("second")).toBe("msg_1");
  });

  /**
   * TEST_SCENARIO: When older history is not loaded, the top message in view
   * is not the first of the conversation, so its fallback must not be null.
   */
  test("never falls back to an empty session under hidden history", () => {
    const points = rewritePointsOf([
      { ...reply("older"), notice: true },
      user("top"),
    ]);

    expect(points.has("top")).toBe(true);
    expect(points.get("top")).toBeUndefined();
  });
});
