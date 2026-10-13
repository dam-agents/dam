import { describe, expect, it } from "vitest";

import type { ClientChannel } from "../../modules/acp/infrastructure/client-channel.js";
import {
  createPromptScheduler,
  type PromptSubmission,
} from "../../modules/acp/services/acp-runtime/prompt-scheduler.js";

/**
 * TEST_OVERVIEW: Why a queued prompt waits, as the queue tells every viewer.
 *
 * A prompt queues behind a running turn, or only until its session can take
 * it — the harness loading it back after a wake, a restart, or a rewind. The
 * second is no wait the user caused, so the queue marks those prompts as
 * starting and the chat shows them as sent rather than queued.
 */

function channel(): ClientChannel {
  return { isOpen: () => true, send: () => {} } as unknown as ClientChannel;
}

function submission(outboundId: number, steerable = true): PromptSubmission {
  return {
    sessionId: "s1",
    channel: channel(),
    outboundId,
    originalId: outboundId,
    frame: { params: { prompt: [] } },
    promptId: `p${outboundId}`,
    steerable,
  };
}

describe("prompt scheduler: starting prompts", () => {
  /**
   * TEST_SCENARIO: The harness has not loaded the session yet and nothing
   * runs ahead. The prompt waits only to start, so the queue marks it.
   */
  it("marks a prompt waiting only for its session as starting", () => {
    const loaded = { yes: false };
    const scheduler = createPromptScheduler({
      canStart: () => loaded.yes,
      onQueueDropped: () => {},
      sendToAgent: () => true,
    });

    expect(scheduler.submit(submission(1))).toBe("queued");
    expect(scheduler.snapshot("s1")).toMatchObject([
      { promptId: "p1", starting: true },
    ]);
  });

  /**
   * TEST_SCENARIO: A prompt behind a running turn is really queued; the
   * queue must not mark it as starting.
   */
  it("does not mark a prompt waiting behind a turn", () => {
    const scheduler = createPromptScheduler({
      canStart: () => true,
      onQueueDropped: () => {},
      sendToAgent: () => true,
    });

    scheduler.submit(submission(1));
    scheduler.submit(submission(2));
    expect(scheduler.snapshot("s1")[0]?.starting).toBeUndefined();
  });
});
