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
import { harnessName } from "../../../lib/fixtures.js";

const agentName = "e2e-delivery";

export { DELIVERY_TIMEOUT_MS };

export const LONG_TURN_MS = DELIVERY_TIMEOUT_MS + 15_000;

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

export async function openMockAgentChat(
  page: Page,
  api: ApiClient,
): Promise<string> {
  await acceptTerms(api);
  await ensureAgentExists(api, agentName, harnessName);
  const agentId = await waitForAgentRunning(api, agentName);
  await loginViaUi(page);
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
