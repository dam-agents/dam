import { expect, test } from "@playwright/test";

import { baseUrl } from "../config.js";
import { createApiClient } from "../lib/api-client.js";
import { getAccessToken } from "../lib/auth.js";

const agentName = "e2e-mock";
const scriptedReply = "scripted-reply-from-e2e";
const userPrompt = "hello-from-playwright";

test("drive mock agent: setScript → prompt → assert reply + received", async ({
  page,
}) => {
  const token = await getAccessToken();
  const api = createApiClient(token);

  await page.goto(baseUrl);
  await expect(page.getByTestId("app-sidebar")).toBeVisible();

  await page.getByRole("button", { name: /add agent/i }).click();
  await page.getByText("mock", { exact: true }).click();

  await page.getByPlaceholder("my-agent").fill(agentName);
  await page.getByRole("button", { name: /create agent/i }).click();

  let agentId = "";
  await expect
    .poll(
      async () => {
        const list = await api.agents.list.query();
        const found = list.find((a) => a.name === agentName);
        if (found) agentId = found.id;
        return Boolean(found);
      },
      { timeout: 30_000, message: `agent ${agentName} not in list` },
    )
    .toBe(true);

  await expect
    .poll(
      async () => {
        const agent = await api.agents.get.query({ id: agentId });
        return agent.state;
      },
      {
        timeout: 180_000,
        intervals: [2_000],
        message: `agent ${agentId} did not reach running state`,
      },
    )
    .toBe("running");

  await api.e2e.setScript.mutate({
    agentId,
    script: {
      entries: [
        {
          sessionUpdate: {
            sessionUpdate: "agent_message_chunk",
            content: { type: "text", text: scriptedReply },
          },
        },
      ],
      stopReason: "end_turn",
    },
  });

  await page.getByRole("heading", { name: agentName }).click();
  await page.waitForURL(new RegExp(`/chat/${encodeURIComponent(agentId)}`));

  const input = page.getByPlaceholder(/message agent/i);
  await input.fill(userPrompt);
  await input.press("Enter");

  await expect(page.getByText(scriptedReply)).toBeVisible({ timeout: 30_000 });

  const { prompts } = await api.e2e.getReceivedPrompts.query({ agentId });
  expect(prompts.length).toBeGreaterThan(0);
  expect(JSON.stringify(prompts)).toContain(userPrompt);
});
