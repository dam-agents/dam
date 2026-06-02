import { expect, test } from "@playwright/test";

import { baseUrl } from "../config.js";
import {
  agentCardStatus,
  agentNameHeading,
  sendMessageToAgent,
  setMockReplyWithFiles,
  waitForAgentRunning,
} from "../lib/agents.js";
import { createApiClient } from "../lib/api-client.js";
import { getAccessToken } from "../lib/auth.js";

const harnessName = "mock";
const agentName = "e2e-lifecycle";
const scriptedReply = "scripted-reply-from-lifecycle";
const userPrompt = "hello-from-lifecycle";
const createdFile = "lifecycle-output.md";
const createdFileContent = "written by the lifecycle mock on prompt";

// Red spec for issue #168: gate opening on readiness. Documents the desired
// not-ready -> ready -> interactive flow, all without a page reload. Expected
// to fail until the gating behavior ships; the sleeping/offline lock is a
// separate flow and out of scope here.
test("agent is not openable until ready, then chats and writes files", async ({
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

  await test.step("create mock agent", async () => {
    await page.getByRole("button", { name: /add agent/i }).click();
    await page.getByText(harnessName, { exact: true }).click();

    await page.getByPlaceholder("my-agent").fill(agentName);
    await page.getByRole("button", { name: /create agent/i }).click();
  });

  await test.step("agent is not openable while starting", async () => {
    // Appears in the list on its own, no reload.
    await expect(agentNameHeading(page, agentName)).toBeVisible({
      timeout: 30_000,
    });
    await expect(agentCardStatus(page, agentName, "Starting")).toBeVisible();

    // Clicking a starting agent is a no-op: it must not reach the detail view.
    await agentNameHeading(page, agentName).click();
    await expect(page).not.toHaveURL(/\/chat\//);
  });

  await test.step("agent becomes openable once running, without reload", async () => {
    await expect(agentCardStatus(page, agentName, "Running")).toBeVisible({
      timeout: 180_000,
    });
  });

  const agentId = await waitForAgentRunning(api, agentName);

  await test.step("open agent and exchange a message", async () => {
    await setMockReplyWithFiles(api, agentId, scriptedReply, [
      { path: createdFile, content: createdFileContent },
    ]);

    await agentNameHeading(page, agentName).click();
    await expect(page).toHaveURL(
      new RegExp(`/chat/${encodeURIComponent(agentId)}`),
    );

    // File browser is empty for the freshly-created file before the prompt.
    await page.getByRole("button", { name: "files", exact: true }).click();
    await page.getByText("work", { exact: true }).click();
    await expect(page.getByText(createdFile, { exact: true })).toHaveCount(0);

    await sendMessageToAgent(page, userPrompt);

    await expect(page.getByText(scriptedReply)).toBeVisible({
      timeout: 30_000,
    });

    // The prompt made the mock write the file into its working dir; it now
    // shows up in the tree (already-expanded `work`) on the next poll.
    await expect(page.getByText(createdFile, { exact: true })).toBeVisible({
      timeout: 30_000,
    });

    const { prompts } = await api.e2e.getReceivedPrompts.query({ agentId });
    expect(prompts.length).toBeGreaterThan(0);
    expect(JSON.stringify(prompts)).toContain(userPrompt);
  });

  // No teardown: leave the agent in place.
});
