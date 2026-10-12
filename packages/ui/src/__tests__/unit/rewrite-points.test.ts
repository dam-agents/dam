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
   * TEST_SCENARIO: A message steered into a running turn sits right below the
   * first message, with no reply between them. It must still offer rewind,
   * and its fallback must not be null: null starts an empty session, which
   * lost the first message.
   */
  test("offers a steered message with no reply above it", () => {
    const points = rewritePointsOf([
      user("first"),
      user("steered", { steered: true }),
      reply("r1", "msg_1"),
    ]);

    expect(points.has("steered")).toBe(true);
    expect(points.get("steered")).toBeUndefined();
  });

  /**
   * TEST_SCENARIO: A message below a reply falls back to cutting after that
   * reply, and the first message to an empty session.
   */
  test("falls back to the reply above, and null for the first message", () => {
    const points = rewritePointsOf([
      user("first"),
      reply("r1", "msg_1"),
      user("second"),
    ]);

    expect(points.get("first")).toBeNull();
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

  /**
   * TEST_SCENARIO: A queued message has not reached the agent and a failed
   * one never will, so neither is a starting point.
   */
  test("skips queued and failed messages", () => {
    const points = rewritePointsOf([
      user("queued", { queued: true }),
      user("failed", { error: { message: "not delivered" } }),
    ]);

    expect([...points.keys()]).toEqual([]);
  });
});
