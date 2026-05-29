import { expect, test } from "@playwright/test";

import { baseUrl } from "../config.js";
import {
  gotoAgentDetail,
  reloadUntilAgentVisible,
  sendMessageToAgent,
  setMockAgentReply,
  waitForAgentRunning,
} from "../lib/agents.js";
import { createApiClient } from "../lib/api-client.js";
import { getAccessToken } from "../lib/auth.js";

const harnessName = "mock";
const agentName = "e2e-mock";
const scriptedReply = "scripted-reply-from-e2e";
const userPrompt = "hello-from-playwright";

test("user can create a mock agent and exchange messages with it", async ({
  page,
}) => {
  const token = await getAccessToken();
  const api = createApiClient(token);

  await test.step("assert clean slate", async () => {
    const existing = (await api.agents.list.query()).find(
      (a) => a.name === agentName,
    );
    expect(
      existing,
      `agent ${agentName} already exists - expected clean slate`,
    ).toBeUndefined();
  });

  await test.step("open app", async () => {
    await page.goto(baseUrl);
    await expect(page.getByTestId("app-sidebar")).toBeVisible();
  });

  const agentId = await test.step("create mock agent", async () => {
    await page.getByRole("button", { name: /add agent/i }).click();
    await page.getByText(harnessName, { exact: true }).click();

    await page.getByPlaceholder("my-agent").fill(agentName);
    await page.getByRole("button", { name: /create agent/i }).click();

    const id = await waitForAgentRunning(api, agentName);

    await reloadUntilAgentVisible(page);

    return id;
  });

  await test.step("send message to agent", async () => {
    await setMockAgentReply(api, agentId, scriptedReply);

    await gotoAgentDetail(page, agentName, agentId);

    await sendMessageToAgent(page, userPrompt);

    await expect(page.getByText(scriptedReply)).toBeVisible({
      timeout: 30_000,
    });

    const { prompts } = await api.e2e.getReceivedPrompts.query({ agentId });
    expect(prompts.length).toBeGreaterThan(0);
    expect(JSON.stringify(prompts)).toContain(userPrompt);
  });
});
