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
  test.setTimeout(300_000);

  const token = await getAccessToken();
  const api = createApiClient(token);

  const agentId = await waitForAgentRunning(api, agentName);
  await setMockAgentReply(api, agentId, scriptedReply);

  await test.step("open the agent chat from the agent list", async () => {
    await openAgentChat(page, agentName, agentId);
  });

  await test.step("the chat view has no top bar: the icon bar reaches the top edge and holds the bell", async () => {
    const bar = page.getByTestId("side-panel-bar");
    await expect(bar.getByTestId("side-panel-tab-approvals")).toBeVisible();
    expect((await bar.boundingBox())?.y).toBe(0);
  });

  await test.step("the new session page names the agent", async () => {
    await expect(
      page.getByRole("heading", { level: 2, name: agentName, exact: true }),
    ).toBeVisible();
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

  await test.step("the agent's name above its reply opens its configuration", async () => {
    await page
      .getByTestId("chat-message")
      .filter({ hasText: scriptedReply })
      .getByRole("button", { name: `Configure ${agentName}` })
      .click();
    await expect(page).toHaveURL(new RegExp(`/sandboxes/${agentId}$`));
  });

  await test.step("the avatar picker opens on hover and closes when the pointer leaves", async () => {
    const picker = page.getByTestId("avatar-picker");
    const grid = page.getByRole("group", { name: "Avatar" });
    await picker.hover();
    await expect(grid).toBeVisible();
    await page.mouse.move(0, 0);
    await expect(grid).toBeHidden();
  });

  await test.step("Enter moves focus into the avatar picker and Escape returns it", async () => {
    const picker = page.getByTestId("avatar-picker");
    const grid = page.getByRole("group", { name: "Avatar" });
    await picker.press("Enter");
    await expect(grid.getByRole("button", { pressed: true })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(grid).toBeHidden();
    await expect(picker).toBeFocused();
  });
});

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
    await setMockAgentReply(api, agentId, scriptedReply);
  }
});
