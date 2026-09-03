import { expect, type Locator, type Page } from "@playwright/test";
import { DELIVERY_TIMEOUT_MS } from "platform-ui/use-prompt-delivery";

import {
  agentCardStatus,
  chatInput,
  ensureAgentExists,
  gotoAgentChat,
  setMockAgentReply,
  waitForAgentRunning,
} from "../../../lib/agents.js";
import type { ApiClient } from "../../../lib/api-client.js";
import { acceptTerms, loginViaUi } from "../../../lib/auth.js";
import { baseUrl } from "../../../config.js";
import { harnessName } from "../../../lib/fixtures.js";

const agentName = "e2e-delivery";

export { DELIVERY_TIMEOUT_MS };

export const LONG_TURN_MS = DELIVERY_TIMEOUT_MS + 15_000;

// The queued-prompt park window the e2e cluster runs with: QUEUE_PARK_MS in
// deploy/helm/platform/values-e2e.yaml, well below agent-runtime's 90s
// default. A spec that waits the window out must wait in real time, so the
// two have to stay in step — a spec sleeping less than the deployed window
// would see prompts still parked and read as a regression.
export const QUEUE_PARK_MS = 8_000;

const MOCK_DEFAULT_REPLY = "Hello from the mock agent.";

export function queuedIndicator(page: Page): Locator {
  return page.getByTestId("prompt-queued-indicator");
}

export function deliveryError(page: Page): Locator {
  return page.getByTestId("prompt-delivery-error");
}

export function retryButton(page: Page): Locator {
  return page.getByTestId("prompt-retry-button");
}

export function undeliveredMarker(page: Page): Locator {
  return page.getByTestId("undelivered-marker");
}

export function undeliveredBubble(page: Page, text: string): Locator {
  return page
    .getByTestId("chat-message")
    .filter({ has: undeliveredMarker(page) })
    .filter({ hasText: text });
}

export async function retryUndelivered(
  page: Page,
  bubble: Locator,
): Promise<void> {
  await bubble.getByTestId("undelivered-actions").click();
  await page.getByRole("menuitem", { name: "Retry" }).click();
}

export async function reopenMockAgentChat(
  page: Page,
  agentId: string,
): Promise<void> {
  await page.goto(`${baseUrl}/coding-agents`);
  await expect(agentCardStatus(page, agentName, "Running")).toBeVisible({
    timeout: 60_000,
  });
  await gotoAgentChat(page, agentName, agentId);
  const sessionRow = page.getByTestId("session-row").first();
  await expect(sessionRow).toBeVisible({ timeout: 60_000 });
  await sessionRow.click();
  await expect(chatInput(page)).toBeVisible();
}

export async function openMockAgentChat(
  page: Page,
  api: ApiClient,
): Promise<string> {
  await acceptTerms(api);
  await ensureAgentExists(api, agentName, harnessName);
  const agentId = await waitForAgentRunning(api, agentName);
  await loginViaUi(page);
  await page.goto(`${baseUrl}/coding-agents`);
  await expect(agentCardStatus(page, agentName, "Running")).toBeVisible();
  await gotoAgentChat(page, agentName, agentId);
  await expect(chatInput(page)).toBeVisible();
  return agentId;
}

export async function restoreMockDefaultReply(
  api: ApiClient,
  agentId: string,
): Promise<void> {
  await setMockAgentReply(api, agentId, MOCK_DEFAULT_REPLY);
}

export async function sendPrompt(page: Page, text: string): Promise<void> {
  const input = chatInput(page);
  await expect(input).toBeVisible();
  await input.fill(text);
  await input.press("Enter");
  await expect(input).toHaveValue("");
}

const PNG_2X2_RED = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFElEQVR4nGP8z8DAwMDAxAADCDYAFEwBP0/pXKUAAAAASUVORK5CYII=",
  "base64",
);

export async function sendPromptWithImage(
  page: Page,
  text: string,
): Promise<void> {
  await page.getByTestId("prompt-attach-input").setInputFiles({
    name: "diagram.png",
    mimeType: "image/png",
    buffer: PNG_2X2_RED,
  });
  await expect(page.locator('img[alt="attachment"]').first()).toBeVisible({
    timeout: 15_000,
  });
  await sendPrompt(page, text);
}

export function bubbleImage(bubble: Locator): Locator {
  return bubble.locator('img[alt="image"]');
}

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
    "expected the turn to finish with no delivery failure raised on the way " +
      "(#829, #3058). 'failure' = a 'Send failed' card appeared first, which " +
      "is the bug; 'never-arrived' / 'no-failure' = the turn itself never " +
      "completed in time, so the scenario never ran",
  ).toBe("milestone");
}
