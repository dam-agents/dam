import { describe, expect, test } from "vitest";

import { applyUpdate } from "../../modules/acp/session-projection.js";
import type { AcpUpdate } from "../../modules/acp/types.js";
import type { Message } from "../../types.js";

/**
 * TEST_OVERVIEW: A message sent while the agent is still answering.
 *
 * The chat cannot know for half a second whether the runtime queues such a
 * message, steers it into the running turn, or starts it. Shown as an ordinary
 * message meanwhile, its reply placeholder took the working indicator from
 * the running reply and gave it back once the queue arrived. So it is shown
 * queued from the start, and the runtime's answer only takes that back when
 * the message was started or steered instead.
 */

const PROMPT = "p2";

function sentWhileBusy(): Message[] {
  return [
    {
      id: "a1",
      role: "assistant",
      parts: [{ kind: "text", text: "a long answer…" }],
      streaming: true,
      promptId: "p1",
    },
    {
      id: PROMPT,
      role: "user",
      parts: [{ kind: "text", text: "and one more thing" }],
      streaming: false,
      queued: true,
    },
    {
      id: "a2",
      role: "assistant",
      parts: [],
      streaming: true,
      promptId: PROMPT,
      queued: true,
    },
  ];
}

function accepted(fields: { queued: boolean; steered?: boolean }): AcpUpdate {
  return {
    sessionUpdate: "platform_prompt_accepted",
    promptId: PROMPT,
    ...fields,
  } as AcpUpdate;
}

function user(messages: Message[]): Message | undefined {
  return messages.find((m) => m.id === PROMPT);
}

describe("a message sent while the agent answers", () => {
  /**
   * TEST_SCENARIO: The runtime confirms the queue. Nothing changes on screen:
   * the message stays queued, and its placeholder never takes the working
   * indicator.
   */
  test("stays queued when the runtime queues it", () => {
    const next = applyUpdate(sentWhileBusy(), accepted({ queued: true }));

    expect(user(next)?.queued).toBe(true);
    expect(next.find((m) => m.id === "a2")?.queued).toBe(true);
  });

  /**
   * TEST_SCENARIO: The turn ended just before the message arrived, so the
   * runtime started it at once. The message must read as sent, not queued.
   */
  test("drops the queued mark when the runtime starts it", () => {
    const next = applyUpdate(sentWhileBusy(), accepted({ queued: false }));

    expect(user(next)?.queued).toBe(false);
    expect(next.find((m) => m.id === "a2")?.queued).toBe(false);
  });

  /**
   * TEST_SCENARIO: The runtime steered the message into the running turn. It
   * is part of that turn now, so it must read as sent and steered.
   */
  test("drops the queued mark when the runtime steers it", () => {
    const next = applyUpdate(
      sentWhileBusy(),
      accepted({ queued: false, steered: true }),
    );

    expect(user(next)).toMatchObject({ queued: false, steered: true });
  });
});
