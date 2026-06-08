import { expect, test } from "@playwright/test";

import { baseUrl } from "../config.js";
import {
  agentCardStatus,
  gotoAgentDetail,
  readChatMessages,
  sendMessageToAgent,
  setMockAgentReply,
  setMockReplyWithMidTurnUserPrompt,
  waitForAgentRunning,
} from "../lib/agents.js";
import { createApiClient } from "../lib/api-client.js";
import { getAccessToken } from "../lib/auth.js";
import { agentName } from "../lib/fixtures.js";

const scriptedReply = "scripted-reply-from-e2e";
const userPrompt = "hello-from-playwright";

const offsetUserPrompt = "what-files-changed-703";
const offsetReplyHead = "Let me check the repository. ";
const offsetBackgroundPrompt = "Run the nightly cleanup task";
const offsetReplyTail = "Found 3 changed files.";

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

test("background prompt mid-turn keeps the reply paired with the user message (#703)", async ({
  page,
}) => {
  // test.fail(
  //   true,
  //   "Reproduces #703: a user_message_chunk arriving mid-turn closes the active assistant bubble, so the reply tail lands under the background prompt instead of the user's message. Remove test.fail once fixed.",
  // );

  const token = await getAccessToken();
  const api = createApiClient(token);

  const agentId = await waitForAgentRunning(api, agentName);
  await setMockReplyWithMidTurnUserPrompt(api, agentId, {
    head: offsetReplyHead,
    midTurnUserPrompt: offsetBackgroundPrompt,
    tail: offsetReplyTail,
  });

  await test.step("open the agent chat", async () => {
    await page.goto(baseUrl);
    await expect(page.getByTestId("app-sidebar")).toBeVisible();
    await expect(agentCardStatus(page, agentName, "Running")).toBeVisible();
    await gotoAgentDetail(page, agentName, agentId);
    await expect(page.getByPlaceholder(/message agent/i)).toBeVisible();
  });

  await test.step("send a prompt and let the interleaved turn stream", async () => {
    await sendMessageToAgent(page, offsetUserPrompt);
    await expect(page.getByText(offsetReplyTail)).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByText(offsetBackgroundPrompt)).toBeVisible();
  });

  await test.step("the full reply stays paired with the user prompt", async () => {
    const rows = await readChatMessages(page);

    const userIdx = rows.findIndex(
      (r) => r.role === "user" && r.text.includes(offsetUserPrompt),
    );
    expect(userIdx).toBeGreaterThanOrEqual(0);

    const reply = rows[userIdx + 1];
    expect(reply?.role).toBe("assistant");
    expect(reply?.text).toContain(offsetReplyHead.trim());
    expect(reply?.text).toContain(offsetReplyTail);
  });
});
