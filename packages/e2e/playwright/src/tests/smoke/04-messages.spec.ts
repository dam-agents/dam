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
import { agentName } from "../../lib/fixtures.js";

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
    await openAgentChat(page, agentName, agentId);
  });

  await test.step("the chat view has no top bar: the icon bar reaches the top edge and holds the bell", async () => {
    const bar = page.getByTestId("side-panel-bar");
    await expect(bar.getByTestId("open-approvals")).toBeVisible();
    expect((await bar.boundingBox())?.y).toBe(0);
  });

  await test.step("the configure button sits right after the agent name", async () => {
    const name = page.getByTitle(`Rename ${agentName}`);
    const configure = page.getByTestId("configure-agent");
    await expect(name).toBeVisible();
    await expect(configure).toBeVisible();
    await expect
      .poll(() =>
        page.evaluate(async (title) => {
          await document.fonts.ready;
          const nameBox = [...document.querySelectorAll("[title]")]
            .find((el) => el.getAttribute("title") === title)
            ?.getBoundingClientRect();
          const configureBox = document
            .querySelector('[data-testid="configure-agent"]')
            ?.getBoundingClientRect();
          return nameBox && configureBox
            ? configureBox.left - nameBox.right
            : Infinity;
        }, `Rename ${agentName}`),
      )
      .toBeLessThan(16);
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
    await setMockAgentReply(api, agentId, scriptedReply);
  }
});
