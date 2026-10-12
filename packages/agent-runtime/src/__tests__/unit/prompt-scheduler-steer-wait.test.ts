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
 * A steer waits until the turn has no open tool call, so the agent reads the
 * prompt next to the tool results and is not cut off mid-tool. Until then the
 * prompt is an ordinary queued one. It never waits longer than the steer wait
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

function schedulerWith(tools: { idle: boolean }) {
  const steer = vi.fn(() => new Promise<never>(() => {}));
  const scheduler = createPromptScheduler({
    canStart: () => true,
    onQueueDropped: () => {},
    sendToAgent: () => true,
    canSteer: () => true,
    steer,
    toolsIdle: () => tools.idle,
    steerWaitMs: STEER_WAIT_MS,
  });
  scheduler.submit(submission(1));
  return { scheduler, steer };
}

describe("prompt scheduler: steering waits for tool calls", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  /**
   * TEST_SCENARIO: A prompt sent while a tool call runs must stay queued, so
   * the user can still change it, and be steered the moment the last open
   * tool call settles.
   */
  it("steers once the turn's tool calls are done", () => {
    const tools = { idle: false };
    const { scheduler, steer } = schedulerWith(tools);

    expect(scheduler.submit(submission(2, { steerable: true }))).toBe("queued");
    expect(steer).not.toHaveBeenCalled();

    tools.idle = true;
    scheduler.onToolsIdle("s1");
    expect(steer).toHaveBeenCalledTimes(1);
  });

  /**
   * TEST_SCENARIO: A tool call can run for a long time. The prompt must not
   * wait for it beyond the steer wait; after that it is steered anyway.
   */
  it("steers anyway once the steer wait has passed", () => {
    const { scheduler, steer } = schedulerWith({ idle: false });

    scheduler.submit(submission(2, { steerable: true }));
    vi.advanceTimersByTime(STEER_WAIT_MS - 1);
    expect(steer).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(steer).toHaveBeenCalledTimes(1);
  });

  /**
   * TEST_SCENARIO: A prompt with no open tool call ahead of it is steered at
   * once, as before the wait existed.
   */
  it("steers at once when no tool call is open", () => {
    const { scheduler, steer } = schedulerWith({ idle: true });

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
    const { scheduler, steer } = schedulerWith({ idle: true });

    expect(scheduler.submitSetting(submission(2))).toBe("queued");
    expect(scheduler.submit(submission(3, { steerable: true }))).toBe("queued");
    vi.advanceTimersByTime(STEER_WAIT_MS * 2);
    expect(steer).not.toHaveBeenCalled();
  });
});
