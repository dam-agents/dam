import { describe, expect, it, vi } from "vitest";

import type { ClientChannel } from "../../modules/acp/infrastructure/client-channel.js";
import {
  createPromptScheduler,
  type PromptSubmission,
} from "../../modules/acp/services/acp-runtime/prompt-scheduler.js";

// TEST_OVERVIEW: the turn-edge callbacks the scheduler exposes — the hooks run accounting hangs on.

function channel(): ClientChannel {
  return {
    isOpen: () => true,
    send: () => {},
  } as unknown as ClientChannel;
}

function submission(sessionId: string, outboundId: number): PromptSubmission {
  return {
    sessionId,
    channel: channel(),
    outboundId,
    originalId: outboundId,
    frame: {},
    promptId: null,
  };
}

describe("prompt scheduler turn hooks", () => {
  /**
   * TEST_SCENARIO: A turn is dropped by a teardown rather than by a response —
   * a session closing, or the harness dying with every turn in flight. An
   * observer timing the turn must be told, or it waits for an end that never
   * comes.
   */
  it("ends a dropped turn on both forget and clear", () => {
    const onTurnEnded = vi.fn();
    const scheduler = createPromptScheduler({
      sendToAgent: () => true,
      onTurnEnded,
    });

    scheduler.submit(submission("s1", 1));
    scheduler.forget("s1");
    expect(onTurnEnded.mock.calls).toEqual([["s1"]]);

    scheduler.forget("s1");
    expect(onTurnEnded).toHaveBeenCalledTimes(1);

    scheduler.submit(submission("s2", 2));
    scheduler.clear();
    expect(onTurnEnded.mock.calls).toEqual([["s1"], ["s2"]]);
  });

  /**
   * TEST_SCENARIO: A prompt the harness refused to take stays queued, so no
   * turn started — timing it would charge the wait to the run.
   */
  it("starts a turn only when the harness took the frame", () => {
    const onTurnStarted = vi.fn();
    const scheduler = createPromptScheduler({
      sendToAgent: () => false,
      onTurnStarted,
    });

    expect(scheduler.submit(submission("s1", 1))).toBe("queued");
    expect(onTurnStarted).not.toHaveBeenCalled();
  });
});
