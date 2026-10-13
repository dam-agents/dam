import { describe, expect, test } from "vitest";

import { applyUpdate } from "../../modules/acp/session-projection.js";
import type { AcpUpdate } from "../../modules/acp/types.js";
import {
  threadItems,
  userRunsOf,
} from "../../modules/sessions/lib/thread-items.js";
import type { Message } from "../../types.js";

/**
 * TEST_OVERVIEW: How the chat shows messages the agent took as one batch.
 *
 * Messages sent while the agent works reach it together, as one message
 * carrying each of them. The chat shows each as its own bubble, under one
 * header, and rewinds or forks them as one. Live, the runtime echoes each
 * message on its own; after a reload, the harness's history holds one user
 * message with a text block each, marked by its block number.
 */

function userChunk(id: string, text: string): AcpUpdate {
  return {
    sessionUpdate: "user_message_chunk",
    messageId: id,
    content: { type: "text", text },
  } as AcpUpdate;
}

function user(id: string, text: string): Message {
  return {
    id,
    role: "user",
    parts: [{ kind: "text", text }],
    streaming: false,
  };
}

function reply(id: string): Message {
  return {
    id,
    role: "assistant",
    parts: [{ kind: "text", text: "ok" }],
    streaming: false,
  };
}

describe("a batch after a reload", () => {
  /**
   * TEST_SCENARIO: The history replays one user message whose second text
   * block is a second message of the batch. It must be its own bubble, not
   * glued to the first ("be grumpybe funny").
   */
  test("shows each text block of a batch as its own bubble", () => {
    let messages = applyUpdate([], userChunk("u2", "be grumpy"));
    messages = applyUpdate(messages, userChunk("u2", "be funny"), {
      block: 1,
    });

    expect(messages.map((m) => [m.id, m.parts])).toEqual([
      ["u2", [{ kind: "text", text: "be grumpy" }]],
      ["u2:1", [{ kind: "text", text: "be funny" }]],
    ]);
  });

  /**
   * TEST_SCENARIO: A harness that streams one message's text in pieces sends
   * no block number; the pieces must still join into one bubble.
   */
  test("still joins the pieces of one streamed message", () => {
    let messages = applyUpdate([], userChunk("u1", "hel"));
    messages = applyUpdate(messages, userChunk("u1", "lo"));

    expect(messages).toHaveLength(1);
    expect(messages[0]!.parts).toEqual([{ kind: "text", text: "hello" }]);
  });
});

describe("userRunsOf", () => {
  /**
   * TEST_SCENARIO: User messages with nothing between them are one run: the
   * first message names it and holds all of them, the rest are drawn inside
   * it. A message on its own is a run of one.
   */
  test("groups user messages with nothing between them", () => {
    const items = threadItems([
      user("u1", "hi"),
      reply("a1"),
      user("u2", "be grumpy"),
      user("u2:1", "be funny"),
      user("u3", "and brief"),
      reply("a2"),
    ]);
    const { runs, inner } = userRunsOf(items);

    expect(runs.get("u1")?.map((m) => m.id)).toEqual(["u1"]);
    expect(runs.get("u2")?.map((m) => m.id)).toEqual(["u2", "u2:1", "u3"]);
    expect([...inner]).toEqual(["u2:1", "u3"]);
  });
});
