import { expect, test } from "@playwright/test";

import { baseUrl } from "../../config.js";
import {
  agentCardStatus,
  chatInput,
  gotoAgentChat,
  sendMessageToAgent,
  setMockAgentReply,
  waitForAgentRunning,
} from "../../lib/agents.js";
import { createApiClient } from "../../lib/api-client.js";
import { getAccessToken } from "../../lib/auth.js";
import { agentName } from "../../lib/fixtures.js";

const scriptedReply = "scripted-reply-for-delete-spec";
const firstPrompt = "hello-before-delete";
const secondPrompt = "hello-after-delete";

const activeRowSelector = '[data-testid="session-row"][data-active="true"]';

test("deleting the active session clears it and lets a fresh session start (#1084)", async ({
  page,
}) => {
  const token = await getAccessToken();
  const api = createApiClient(token);

  const agentId = await waitForAgentRunning(api, agentName);
  await setMockAgentReply(api, agentId, scriptedReply);

  await test.step("open the agent chat and start an active session", async () => {
    await page.goto(`${baseUrl}/coding-agents`);
    await expect(page.getByTestId("app-sidebar")).toBeVisible();
    await expect(agentCardStatus(page, agentName, "Running")).toBeVisible();
    await gotoAgentChat(page, agentName, agentId);
    await expect(chatInput(page)).toBeVisible();

    await sendMessageToAgent(page, firstPrompt);
    await expect(page.getByText(scriptedReply)).toBeVisible({
      timeout: 30_000,
    });
  });

  const activeRow = page.locator(activeRowSelector);
  await expect(activeRow).toHaveCount(1);
  const deletedSessionId = await activeRow.getAttribute("data-session-id");
  expect(deletedSessionId).toBeTruthy();
  const deletedRow = page.locator(
    `[data-testid="session-row"][data-session-id="${deletedSessionId}"]`,
  );

  await test.step("(A) deleting the active session removes it without a refresh", async () => {
    await activeRow.hover();
    await activeRow.getByTestId("session-menu-button").click();
    await page.getByTestId("session-delete-button").click();
    await page
      .getByRole("alertdialog")
      .getByRole("button", { name: "Confirm" })
      .click();
    await expect(page.getByText("Session deleted")).toBeVisible();
    await expect(deletedRow).toHaveCount(0);
  });

  await test.step("(B) a session started right after the delete appears in the sidebar", async () => {
    await expect(chatInput(page)).toBeVisible();
    await sendMessageToAgent(page, secondPrompt);
    await expect(page.getByText(scriptedReply)).toBeVisible({
      timeout: 30_000,
    });
    const freshRow = page.locator(activeRowSelector);
    await expect(freshRow).toHaveCount(1);
    await expect(freshRow).not.toHaveAttribute(
      "data-session-id",
      deletedSessionId ?? "",
    );
  });
});
