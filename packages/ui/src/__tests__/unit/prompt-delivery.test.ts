// TEST_OVERVIEW: the client side of prompt delivery. Each send starts a bounded wait for the runtime's acceptance notice, and the send is failed as undelivered only when that notice never comes. The notice must reach the delivery tracker on every socket the client sent over, whether or not the chat still shows that session, because a prompt the runtime accepted is never undelivered.
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import type { AcpUpdate, UpdateHandler } from "../../modules/acp/types.js";
import {
  createPromptDelivery,
  DELIVERY_TIMEOUT_MS,
  WAKE_DELIVERY_TIMEOUT_MS,
  withDeliveryTracking,
} from "../../modules/sessions/lib/prompt-delivery.js";

const SESSION = "session-sent";
const PROMPT = "prompt-1";

const accepted = (queued = false): AcpUpdate => ({
  sessionUpdate: "platform_prompt_accepted",
  sessionId: SESSION,
  promptId: PROMPT,
  queued,
});

const started: AcpUpdate = {
  sessionUpdate: "platform_prompt_started",
  sessionId: SESSION,
  promptId: PROMPT,
};

const dropEverything: UpdateHandler = () => {};

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("prompt delivery", () => {
  // TEST_SCENARIO: the first prompt to a hibernated agent wakes it. The api-server forwards the prompt only once the agent is ready, which may take most of its two-minute wake budget, so the send is not judged undelivered within the ordinary window; it is once the wake budget and the acknowledgement window have both passed with no acceptance.
  test("a prompt that wakes a sleeping agent waits out the wake before it is called undelivered", () => {
    const delivery = createPromptDelivery();
    const fail = vi.fn();
    delivery.beginSend(PROMPT, fail, { waking: true });
    vi.advanceTimersByTime(DELIVERY_TIMEOUT_MS);
    expect(fail).not.toHaveBeenCalled();
    vi.advanceTimersByTime(WAKE_DELIVERY_TIMEOUT_MS - DELIVERY_TIMEOUT_MS);
    expect(fail).toHaveBeenCalledTimes(1);
  });

  // TEST_SCENARIO: an acceptance that arrives during the wake ends the longer wait the same way it ends the ordinary one.
  test("an acceptance during the wake ends the longer wait", () => {
    const delivery = createPromptDelivery();
    const fail = vi.fn();
    const onFrame = withDeliveryTracking(delivery, dropEverything);
    delivery.beginSend(PROMPT, fail, { waking: true });
    vi.advanceTimersByTime(DELIVERY_TIMEOUT_MS);
    onFrame(accepted(), SESSION);
    vi.advanceTimersByTime(WAKE_DELIVERY_TIMEOUT_MS * 2);
    expect(fail).not.toHaveBeenCalled();
  });
  // TEST_SCENARIO: the user sends the first prompt of a new chat and leaves the page before the socket settles. The send is detached from the view, so the socket stops projecting frames into the chat. The runtime still accepts the prompt on that socket and the turn runs for minutes. The acceptance must still end the wait, or the send is failed after DELIVERY_TIMEOUT_MS and recorded as undelivered for a prompt the agent answered.
  test("an acceptance on a socket detached from the view ends the wait", () => {
    const delivery = createPromptDelivery();
    const fail = vi.fn();
    const onFrame = withDeliveryTracking(delivery, dropEverything);

    delivery.beginSend(PROMPT, fail);
    onFrame(accepted(), SESSION);
    vi.advanceTimersByTime(DELIVERY_TIMEOUT_MS * 5);

    expect(fail).not.toHaveBeenCalled();
  });

  // TEST_SCENARIO: the chat has moved on to another session while the send is in flight. The projection ignores frames for a session that is not on screen, but the acceptance names its prompt id, so it must still end the wait for that send.
  test("an acceptance for a session that is not on screen ends the wait", () => {
    const delivery = createPromptDelivery();
    const fail = vi.fn();
    const viewing = "session-on-screen";
    const projected: string[] = [];
    const onFrame = withDeliveryTracking(delivery, (_update, sessionId) => {
      if (sessionId !== viewing) return;
      projected.push(sessionId);
    });

    delivery.beginSend(PROMPT, fail);
    onFrame(accepted(), SESSION);
    vi.advanceTimersByTime(DELIVERY_TIMEOUT_MS * 5);

    expect(fail).not.toHaveBeenCalled();
    expect(projected).toEqual([]);
  });

  // TEST_SCENARIO: no acceptance within the bounded wait is the evidence that a prompt never arrived. Leaving the chat must not hide that evidence: a send the runtime never acknowledged is still failed once DELIVERY_TIMEOUT_MS passes.
  test("a send with no acceptance is failed after the bounded wait", () => {
    const delivery = createPromptDelivery();
    const fail = vi.fn();

    delivery.beginSend(PROMPT, fail);
    vi.advanceTimersByTime(DELIVERY_TIMEOUT_MS - 1);
    expect(fail).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(fail).toHaveBeenCalledOnce();
  });

  // TEST_SCENARIO: a prompt queued behind a running turn is accepted with queued set. Waiting is unbounded, so the send is never failed for waiting, however long the turn ahead of it runs.
  test("a queued prompt is never failed for waiting", () => {
    const delivery = createPromptDelivery();
    const fail = vi.fn();
    const onFrame = withDeliveryTracking(delivery, dropEverything);

    delivery.beginSend(PROMPT, fail);
    onFrame(accepted(true), SESSION);
    vi.advanceTimersByTime(DELIVERY_TIMEOUT_MS * 20);

    expect(fail).not.toHaveBeenCalled();
  });

  // TEST_SCENARIO: tracking delivery must not change what the chat shows. Every frame still reaches the projection handler, with its session id and frame metadata.
  test("every frame still reaches the wrapped handler", () => {
    const delivery = createPromptDelivery();
    const seen: Array<[string, string, string | undefined]> = [];
    const onFrame = withDeliveryTracking(delivery, (update, sessionId, frame) =>
      seen.push([update.sessionUpdate, sessionId, frame?.at]),
    );

    onFrame(accepted(), SESSION, { at: "t1" });
    onFrame(started, SESSION);

    expect(seen).toEqual([
      ["platform_prompt_accepted", SESSION, "t1"],
      ["platform_prompt_started", SESSION, undefined],
    ]);
  });
});
