import { describe, expect, test } from "vitest";

import {
  applyUpdate,
  isQueuedSend,
  sendWaits,
  withoutQueuedSends,
} from "../../modules/acp/session-projection.js";
import type { AcpUpdate } from "../../modules/acp/types.js";
import type { Message } from "../../types.js";

/**
 * TEST_OVERVIEW: What happens to a message the user sends.
 *
 * Two steps: a message is queued, then sent when the runtime can take it.
 * When the chat is sure the session is idle — no reply streaming, nothing in
 * the runtime's queue, no earlier send still waiting — the message shows as
 * sent at once. Otherwise it joins the queue below the conversation at once,
 * and moves into the conversation only when the runtime starts it or steers
 * it into the running turn. While it waits, the running reply stays the last
 * message and keeps the working indicator.
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

describe("a sent message: queued, then sent", () => {
  /**
   * TEST_SCENARIO: A message sent while the agent answers stays queued while
   * the runtime queues it — out of the conversation, so the running reply
   * stays last — and moves in once the runtime starts it. A message the
   * runtime marks starting, waiting only for its session, stays in the
   * conversation as sent: nothing runs ahead of it.
   */
  test("moves into the conversation only when it starts", () => {
    const queued = applyUpdate(sentWhileBusy(), accepted({ queued: true }));
    expect(user(queued)?.queued).toBe(true);
    expect(queued.filter((m) => !isQueuedSend(m)).map((m) => m.id)).toEqual([
      "a1",
    ]);

    const started = applyUpdate(sentWhileBusy(), accepted({ queued: false }));
    expect(user(started)?.queued).toBe(false);

    const starting = [{ ...user(started)! }];
    expect(
      withoutQueuedSends(starting, [
        {
          promptId: PROMPT,
          blocks: [],
          queuedAt: "",
          editable: true,
          starting: true,
        },
      ]),
    ).toEqual(starting);
  });

  /**
   * TEST_SCENARIO: The runtime steered the message into the running turn. It
   * is part of that turn now, so it must read as sent and steered, its reply
   * placeholder gone.
   */
  test("drops the queued mark when the runtime steers it", () => {
    const next = applyUpdate(
      sentWhileBusy(),
      accepted({ queued: false, steered: true }),
    );

    expect(user(next)).toMatchObject({ queued: false, steered: true });
    expect(next.some((m) => m.id === "a2")).toBe(false);
  });

  /**
   * TEST_SCENARIO: Only when nothing streams, nothing is queued and no
   * earlier send waits is a message sent at once; any of them means it
   * queues behind.
   */
  test("waits unless the session is surely idle", () => {
    const idle: Message[] = [
      {
        id: "a0",
        role: "assistant",
        parts: [{ kind: "text", text: "done" }],
        streaming: false,
      },
    ];
    const queue = [
      { promptId: "p0", blocks: [], queuedAt: "", editable: true },
    ];

    expect(sendWaits(idle, [])).toBe(false);
    expect(sendWaits(sentWhileBusy().slice(0, 1), [])).toBe(true);
    expect(sendWaits(idle, queue)).toBe(true);
    expect(sendWaits(sentWhileBusy().slice(1), [])).toBe(true);
  });
});
