import { describe, expect, test } from "vitest";

import { applyUpdate } from "../../modules/acp/session-projection.js";
import type { AcpUpdate } from "../../modules/acp/types.js";
import type { Message } from "../../types.js";

/**
 * TEST_OVERVIEW: Where the chat draws a message steered into a running turn.
 *
 * The runtime steers a message only once the agent's tool calls are done, so
 * the agent reads it after that work. The chat must draw it there too: below
 * the tool call it waited for, with the rest of the turn below it — live, and
 * the same after a reload, when the turn comes back from the log.
 */

const TURN = { turnId: "t1" };

function userEcho(id: string, text: string, steered = false): AcpUpdate {
  return {
    sessionUpdate: "user_message_chunk",
    messageId: id,
    content: { type: "text", text },
    ...(steered && { _meta: { steered: true } }),
  } as AcpUpdate;
}

const toolCall = {
  sessionUpdate: "tool_call",
  toolCallId: "tool-1",
  title: "sleep 30",
  status: "in_progress",
} as AcpUpdate;

const toolDone = {
  sessionUpdate: "tool_call_update",
  toolCallId: "tool-1",
  status: "completed",
} as AcpUpdate;

const reply = {
  sessionUpdate: "agent_message_chunk",
  messageId: "msg_b",
  content: { type: "text", text: "Have a bad day, Petr!" },
} as AcpUpdate;

function shape(messages: Message[]): string[] {
  return messages
    .filter((m) => m.parts.length > 0)
    .map((m) =>
      m.parts
        .map((p) => ("text" in p ? p.text : "title" in p ? p.title : p.kind))
        .join(" + "),
    );
}

describe("steered message placement", () => {
  /**
   * TEST_SCENARIO: The message must sit between the tool call it waited for
   * and the rest of the reply — live, while the sender's turn still streams
   * when the echo arrives, and after a reload, when the turn replays from the
   * log in the order the runtime wrote it.
   */
  test("draws a steered message below the tool call it waited for", () => {
    {
      const messages = [
        [userEcho("u1", "My name is Petr"), {}],
        [toolCall, TURN],
        [toolDone, TURN],
        [userEcho("u2", "I changed my mind", true), {}],
        [reply, TURN],
      ].reduce<Message[]>(
        (acc, [u, meta]) => applyUpdate(acc, u as AcpUpdate, meta as object),
        [],
      );

      expect(shape(messages)).toEqual([
        "My name is Petr",
        "sleep 30",
        "I changed my mind",
        "Have a bad day, Petr!",
      ]);
    }
    {
      const live: Message[] = [
        {
          id: "u1",
          role: "user",
          parts: [{ kind: "text", text: "My name is Petr" }],
          streaming: false,
        },
        {
          id: "a1",
          role: "assistant",
          parts: [],
          streaming: true,
          promptId: "u1",
          turnId: "t1",
        },
      ];
      const messages = [
        [toolCall, TURN],
        [toolDone, TURN],
        [userEcho("u2", "I changed my mind", true), {}],
        [reply, TURN],
      ].reduce<Message[]>(
        (acc, [u, meta]) => applyUpdate(acc, u as AcpUpdate, meta as object),
        live,
      );

      expect(shape(messages)).toEqual([
        "My name is Petr",
        "sleep 30",
        "I changed my mind",
        "Have a bad day, Petr!",
      ]);
    }
  });
});
