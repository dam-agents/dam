import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ClientChannel } from "../../modules/acp/infrastructure/client-channel.js";
import {
  createPromptScheduler,
  type PromptSubmission,
} from "../../modules/acp/services/acp-runtime/prompt-scheduler.js";

/**
 * TEST_OVERVIEW: When the Prompt Scheduler steers a prompt into the running
 * turn.
 *
 * A steer waits for a steer point: the agent is not writing and has no tool
 * call open. The harness aborts whatever the agent is generating to take a
 * steer, so steering outside one cuts a reply off. Until then the prompt is an
 * ordinary queued one. It never waits longer than the steer wait
 * (`steerWaitMs`): after that it is steered regardless. A setting queued
 * before the prompt — a model or mode change — applies between turns, so a
 * prompt behind one is never steered past it.
 */

const STEER_WAIT_MS = 1_000;

function channel(): ClientChannel {
  return { isOpen: () => true, send: () => {} } as unknown as ClientChannel;
}

function submission(
  outboundId: number,
  extra: Partial<PromptSubmission> = {},
): PromptSubmission {
  return {
    sessionId: "s1",
    channel: channel(),
    outboundId,
    originalId: outboundId,
    frame: {},
    promptId: `p${outboundId}`,
    ...extra,
  };
}

function schedulerWith(point: { reached: boolean }) {
  const steer = vi.fn(() => new Promise<never>(() => {}));
  const scheduler = createPromptScheduler({
    canStart: () => true,
    onQueueDropped: () => {},
    sendToAgent: () => true,
    canSteer: () => true,
    steer,
    atSteerPoint: () => point.reached,
    steerWaitMs: STEER_WAIT_MS,
  });
  scheduler.submit(submission(1));
  return { scheduler, steer };
}

describe("prompt scheduler: steering waits for a steer point", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  /**
   * TEST_SCENARIO: A prompt sent while the agent writes or runs a tool must
   * stay queued, so the user can still change it, and be steered the moment
   * the turn reaches a steer point.
   */
  it("steers once the turn reaches a steer point", () => {
    const point = { reached: false };
    const { scheduler, steer } = schedulerWith(point);

    expect(scheduler.submit(submission(2, { steerable: true }))).toBe("queued");
    expect(steer).not.toHaveBeenCalled();

    point.reached = true;
    scheduler.onSteerPoint("s1");
    expect(steer).toHaveBeenCalledTimes(1);
  });

  /**
   * TEST_SCENARIO: A tool call or a reply can run for a long time. The prompt
   * must not wait for a steer point beyond the steer wait; after that it is
   * steered anyway.
   */
  it("steers anyway once the steer wait has passed", () => {
    const { scheduler, steer } = schedulerWith({ reached: false });

    scheduler.submit(submission(2, { steerable: true }));
    vi.advanceTimersByTime(STEER_WAIT_MS - 1);
    expect(steer).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(steer).toHaveBeenCalledTimes(1);
  });

  /**
   * TEST_SCENARIO: A prompt sent at a steer point is steered at once.
   */
  it("steers at once at a steer point", () => {
    const { scheduler, steer } = schedulerWith({ reached: true });

    expect(scheduler.submit(submission(2, { steerable: true }))).toBe(
      "steering",
    );
    expect(steer).toHaveBeenCalledTimes(1);
  });

  /**
   * TEST_SCENARIO: A session setting sent during the turn applies when the
   * turn ends. A prompt sent after it must run with that setting, so it is
   * queued behind it and never steered into the current turn.
   */
  it("never steers a prompt past a pending setting", () => {
    const { scheduler, steer } = schedulerWith({ reached: true });

    expect(scheduler.submitSetting(submission(2))).toBe("queued");
    expect(scheduler.submit(submission(3, { steerable: true }))).toBe("queued");
    vi.advanceTimersByTime(STEER_WAIT_MS * 2);
    expect(steer).not.toHaveBeenCalled();
  });
});
