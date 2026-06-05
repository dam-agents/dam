import { expect, test } from "@playwright/test";

import { baseUrl } from "../config.js";
import {
  agentCardStatus,
  gotoAgentDetail,
  sendMessageToAgent,
  setMockAgentReply,
  waitForAgentRunning,
} from "../lib/agents.js";
import { createApiClient } from "../lib/api-client.js";
import { getAccessToken } from "../lib/auth.js";
import { agentName } from "../lib/fixtures.js";

const scriptedReply = "scripted-reply-from-e2e";
const userPrompt = "hello-from-playwright";

test("exchange messages with the agent", async ({ page }) => {
  const token = await getAccessToken();
  const api = createApiClient(token);

  const agentId = await waitForAgentRunning(api, agentName);
  await setMockAgentReply(api, agentId, scriptedReply);

  await test.step("open the agent chat from the agent list", async () => {
    await page.goto(baseUrl);
    await expect(page.getByTestId("app-sidebar")).toBeVisible();

    await expect(agentCardStatus(page, agentName, "Running")).toBeVisible();

    await gotoAgentDetail(page, agentName, agentId);

    await expect(page.getByPlaceholder(/message agent/i)).toBeVisible();
  });

  await test.step("send a message and receive the scripted reply", async () => {
    await sendMessageToAgent(page, userPrompt);

    await expect(page.getByText(scriptedReply)).toBeVisible({
      timeout: 30_000,
    });

    const { prompts } = await api.e2e.getReceivedPrompts.query({ agentId });
    expect(prompts.length).toBeGreaterThan(0);
    expect(JSON.stringify(prompts)).toContain(userPrompt);
  });
});
