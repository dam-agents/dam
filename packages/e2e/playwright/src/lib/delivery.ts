import { expect, type Locator, type Page } from "@playwright/test";

import {
  agentCardStatus,
  chatInput,
  gotoAgentDetail,
  setMockAgentReply,
  waitForAgentRunning,
} from "./agents.js";
import type { ApiClient } from "./api-client.js";
import { loginViaUi } from "./auth.js";
import { agentName } from "./fixtures.js";

/** The UI's own delivery deadline (`DELIVERY_TIMEOUT_MS` in
 *  use-prompt-delivery.ts). Not restated as a bare literal at the call sites:
 *  every assertion below is positioned relative to this boundary, so if the
 *  timeout ever moves the assertions have to move with it rather than quietly
 *  stop testing anything. */
export const DELIVERY_TIMEOUT_MS = 60_000;

/** A scripted turn long enough to outlive the deadline with room on both
 *  sides. Crossing it is the whole #829 regression: waiting is not failing, no
 *  matter how long the prior turn runs. */
export const LONG_TURN_MS = DELIVERY_TIMEOUT_MS + 15_000;

/** The mock's out-of-the-box reply. The shared `e2e-agent` is also driven by
 *  the smoke chain (08/10-slack, 12-experiments rely on this text verbatim),
 *  and full-tier projects carry no dependency edges that would order them
 *  after it — so every spec here restores the script it overwrote. */
const MOCK_DEFAULT_REPLY = "Hello from the mock agent.";

/** "Waiting for previous prompt…" — server truth now
 *  (`platform/promptAccepted` with `queued: true`), so it lands within a round
 *  trip of the send rather than being guessed from local streaming state. */
export function queuedIndicator(page: Page): Locator {
  return page.getByTestId("prompt-queued-indicator");
}

/** The "Send failed: …" card. Deliberately not scoped to one bubble: the
 *  feature's claim is that *nothing* reports a delivery failure while a prompt
 *  is merely waiting, so any visible card fails these specs. */
export function deliveryError(page: Page): Locator {
  return page.getByTestId("prompt-delivery-error");
}

export function retryButton(page: Page): Locator {
  return page.getByTestId("prompt-retry-button");
}

/**
 * Open the shared mock agent's chat in a logged-in browser. Full-tier specs
 * are self-contained by convention (no `storageState`), and every spec here
 * drives the real chat UI, so this is their common prologue.
 */
export async function openMockAgentChat(
  page: Page,
  api: ApiClient,
): Promise<string> {
  const agentId = await waitForAgentRunning(api, agentName);
  await loginViaUi(page);
  await expect(agentCardStatus(page, agentName, "Running")).toBeVisible();
  await gotoAgentDetail(page, agentName, agentId);
  await expect(chatInput(page)).toBeVisible();
  return agentId;
}

/** Hand the shared agent back the way the smoke chain expects to find it. */
export async function restoreMockDefaultReply(
  api: ApiClient,
  agentId: string,
): Promise<void> {
  await setMockAgentReply(api, agentId, MOCK_DEFAULT_REPLY);
}

/**
 * Type a prompt and send it.
 *
 * Not `sendMessageToAgent`: mid-turn the placeholder flips to "Queue a
 * message…" and Enter must still dispatch (the runtime queues server-side),
 * which is the path these specs exercise. Asserting the box empties is how we
 * know the send actually fired rather than the UI having disabled itself.
 */
export async function sendPrompt(page: Page, text: string): Promise<void> {
  const input = chatInput(page);
  await expect(input).toBeVisible();
  await input.fill(text);
  await input.press("Enter");
  await expect(input).toHaveValue("");
}

/**
 * Assert that `milestone` is reached without any delivery failure showing up
 * on the way there.
 *
 * The naive spelling — `await expect(deliveryError(page)).not.toBeVisible()` —
 * proves nothing: it passes the instant the card is absent, which is always
 * true right after a send. `expect.poll(...).toBe(0)` is no better, since poll
 * also stops at the first pass. What's needed is an assertion held open
 * *across* the 60s boundary, so this races the two outcomes instead: whichever
 * appears first decides. Event-anchored, so it adds no fixed sleep, and it
 * fails at the exact moment a UI running the old send-anchored watchdog lies.
 */
export async function expectMilestoneBeforeFailure(
  page: Page,
  milestone: Locator,
  timeoutMs: number,
): Promise<void> {
  const failed = deliveryError(page)
    .waitFor({ state: "visible", timeout: timeoutMs })
    .then(
      () => "failure" as const,
      () => "no-failure" as const,
    );
  const reached = milestone
    .waitFor({ state: "visible", timeout: timeoutMs })
    .then(
      () => "milestone" as const,
      () => "never-arrived" as const,
    );

  const first = await Promise.race([failed, reached]);
  expect(
    first,
    "expected the prior turn to finish with no delivery failure raised while " +
      "the prompt waited (#829). 'failure' = a 'Send failed' card appeared " +
      "first, which is the bug; 'never-arrived' / 'no-failure' = the turn " +
      "itself never completed in time, so the scenario never ran",
  ).toBe("milestone");
}
