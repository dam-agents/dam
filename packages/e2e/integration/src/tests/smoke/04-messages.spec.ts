import { expect, test } from "@playwright/test";

import {
  openAgentChat,
  sendMessageToAgent,
  setMockAgentReply,
  setMockReplyWithMidTurnUserPrompt,
  waitForAgentRunning,
} from "../../lib/agents.js";
import { createApiClient } from "../../lib/api-client.js";
import { getAccessToken } from "../../lib/auth.js";
import { agentName, mockDefaultReply } from "../../lib/fixtures.js";

const offsetUserPrompt = "what-files-changed-703";
const offsetReplyHead = "Let me check the repository. ";
const offsetBackgroundPrompt = "Run the nightly cleanup task";
const offsetReplyTail = "Found 3 changed files.";

// TEST_OVERVIEW: a background prompt the agent receives mid-turn keeps the chat's reply paired with the person's message (#703). Sending a message and getting the answer, and the agent's settings over its chat, are Examples of the acceptance suite (features/agents/agents.feature, features/agents/settings.feature).
test("background prompt mid-turn keeps the reply paired with the user message (#703)", async ({
  page,
}) => {
  test.setTimeout(300_000);

  const token = await getAccessToken();
  const api = createApiClient(token);

  const agentId = await waitForAgentRunning(api, agentName);
  await setMockReplyWithMidTurnUserPrompt(api, agentId, {
    head: offsetReplyHead,
    midTurnUserPrompt: offsetBackgroundPrompt,
    tail: offsetReplyTail,
  });

  try {
    await test.step("open the agent chat", async () => {
      await openAgentChat(page, agentName, agentId);
    });

    await test.step("the interleaved reply stays paired with the user prompt", async () => {
      await sendMessageToAgent(page, offsetUserPrompt);
      const userMessage = page.getByTestId("chat-message").filter({
        has: page.getByText(offsetUserPrompt, { exact: true }),
      });
      await expect(userMessage).toBeVisible();
      await expect(userMessage).toHaveAttribute("data-role", "user");

      const reply = userMessage.locator(
        'xpath=following-sibling::*[@data-testid="chat-message"][1]',
      );
      await expect(reply).toHaveAttribute("data-role", "assistant");
      await expect(reply).toContainText(offsetReplyHead.trim());
      await expect(reply).toContainText(offsetReplyTail, { timeout: 30_000 });

      const backgroundPrompt = reply.locator(
        'xpath=following-sibling::*[@data-testid="chat-message"][1]',
      );
      await expect(backgroundPrompt).toHaveAttribute("data-role", "user");
      await expect(backgroundPrompt).toContainText(offsetBackgroundPrompt);
    });
  } finally {
    await setMockAgentReply(api, agentId, mockDefaultReply);
  }
});
