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

  /**
   * TEST_SCENARIO: The queue below the conversation shows the message from
   * the start, so the conversation leaves it out. The running reply then stays
   * the last message, keeps the working indicator, and never fades in again.
   */
  test("leaves the conversation to the running reply", () => {
    const shown = sentWhileBusy().filter((m) => !isQueuedSend(m));

    expect(shown.map((m) => m.id)).toEqual(["a1"]);
  });

  /**
   * TEST_SCENARIO: Nothing runs and nothing waits, so the message is sent
   * at once and shows in the conversation right away, with no queued step.
   */
  test("shows as sent at once when the session is idle", () => {
    const idle: Message[] = [
      {
        id: "a0",
        role: "assistant",
        parts: [{ kind: "text", text: "done" }],
        streaming: false,
      },
    ];

    expect(sendWaits(idle, [])).toBe(false);
  });

  /**
   * TEST_SCENARIO: A reply streams, the runtime holds a queue, or an earlier
   * send still waits: any of them means the new message must queue behind.
   */
  test("waits behind a running reply, a queue, or an earlier send", () => {
    const queued = [
      { promptId: "p0", blocks: [], queuedAt: "", editable: true },
    ];
    const pendingOnly = sentWhileBusy().filter((m) => m.id !== "a1");

    expect(sendWaits(sentWhileBusy().slice(0, 1), [])).toBe(true);
    expect(sendWaits([], queued)).toBe(true);
    expect(sendWaits(pendingOnly, [])).toBe(true);
  });
});

describe("a message waiting only for its session", () => {
  /**
   * TEST_SCENARIO: After a wake, a restart or a rewind, the runtime queues a
   * message until the harness has loaded the session, and marks it starting.
   * Nothing runs ahead of it, so the chat must keep it in the conversation as
   * sent rather than move it into the queue.
   */
  test("stays in the conversation while it is starting", () => {
    const sent: Message[] = [
      {
        id: PROMPT,
        role: "user",
        parts: [{ kind: "text", text: "hi" }],
        streaming: false,
      },
    ];

    expect(
      withoutQueuedSends(sent, [
        {
          promptId: PROMPT,
          blocks: [],
          queuedAt: "",
          editable: true,
          starting: true,
        },
      ]),
    ).toEqual(sent);
  });
});
