import { expect, test } from "@playwright/test";

import {
  chatInput,
  openAgentChat,
  sendMessageToAgent,
  setMockAgentReply,
  waitForAgentRunning,
} from "../../lib/agents.js";
import { createApiClient } from "../../lib/api-client.js";
import { getAccessToken } from "../../lib/auth.js";
import { agentName } from "../../lib/fixtures.js";

const scriptedReply = "scripted-reply-for-delete-spec";
const firstPrompt = "hello-inactive-session";
const secondPrompt = "hello-active-session";
const thirdPrompt = "hello-after-active-delete";

const activeRowSelector = '[data-testid="session-row"][data-active="true"]';

test("deleting inactive and active sessions preserves the right navigation (#4239, #1084)", async ({
  page,
}) => {
  const token = await getAccessToken();
  const api = createApiClient(token);

  const agentId = await waitForAgentRunning(api, agentName);
  await setMockAgentReply(api, agentId, scriptedReply);

  await test.step("open the agent chat and start an active session", async () => {
    await openAgentChat(page, agentName, agentId);

    await sendMessageToAgent(page, firstPrompt);
    await expect(page.getByText(scriptedReply)).toBeVisible({
      timeout: 30_000,
    });
  });

  const activeRow = page.locator(activeRowSelector);
  await expect(activeRow).toHaveCount(1);
  const inactiveSessionId = await activeRow.getAttribute("data-session-id");
  expect(inactiveSessionId).toBeTruthy();
  const inactiveRow = page.locator(
    `[data-testid="session-row"][data-session-id="${inactiveSessionId}"]`,
  );

  await test.step("start a second session and keep it active", async () => {
    await page.getByRole("button", { name: "New", exact: true }).click();
    await expect(chatInput(page)).toBeVisible();
    await sendMessageToAgent(page, secondPrompt);
    await expect(page.getByText(scriptedReply)).toBeVisible({
      timeout: 30_000,
    });
    await expect(activeRow).not.toHaveAttribute(
      "data-session-id",
      inactiveSessionId ?? "",
    );
  });

  const activeSessionId = await activeRow.getAttribute("data-session-id");
  expect(activeSessionId).toBeTruthy();
  const activeSessionRow = page.locator(
    `[data-testid="session-row"][data-session-id="${activeSessionId}"]`,
  );

  await test.step("(A) cancelling an inactive-session delete keeps the active session open", async () => {
    await inactiveRow.hover();
    await inactiveRow.getByTestId("session-menu-button").click();
    await page.getByTestId("session-delete-button").click();

    const dialog = page.getByRole("alertdialog");
    await expect(dialog).toBeVisible();
    await expect(activeRow).toHaveAttribute(
      "data-session-id",
      activeSessionId ?? "",
    );
    await expect(page.getByText(secondPrompt, { exact: true })).toBeVisible();

    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(inactiveRow).toHaveCount(1);
    await expect(activeRow).toHaveAttribute(
      "data-session-id",
      activeSessionId ?? "",
    );
    await expect(page.getByText(secondPrompt, { exact: true })).toBeVisible();
  });

  await test.step("(B) deleting an inactive session keeps the active session open", async () => {
    await inactiveRow.hover();
    await inactiveRow.getByTestId("session-menu-button").click();
    await page.getByTestId("session-delete-button").click();
    await page
      .getByRole("alertdialog")
      .getByRole("button", { name: "Confirm" })
      .click();
    await expect(page.getByText("Session deleted")).toBeVisible();
    await expect(inactiveRow).toHaveCount(0);
    await expect(activeRow).toHaveAttribute(
      "data-session-id",
      activeSessionId ?? "",
    );
    await expect(page.getByText(secondPrompt, { exact: true })).toBeVisible();
  });

  await test.step("(C) deleting the active session removes it without a refresh", async () => {
    await activeSessionRow.hover();
    await activeSessionRow.getByTestId("session-menu-button").click();
    await page.getByTestId("session-delete-button").click();
    await page
      .getByRole("alertdialog")
      .getByRole("button", { name: "Confirm" })
      .click();
    await expect(page.getByText("Session deleted")).toBeVisible();
    await expect(activeSessionRow).toHaveCount(0);
  });

  await test.step("(D) a session started right after the delete appears in the sidebar", async () => {
    await expect(chatInput(page)).toBeVisible();
    await sendMessageToAgent(page, thirdPrompt);
    await expect(page.getByText(scriptedReply)).toBeVisible({
      timeout: 30_000,
    });
    const freshRow = page.locator(activeRowSelector);
    await expect(freshRow).toHaveCount(1);
    await expect(freshRow).not.toHaveAttribute(
      "data-session-id",
      activeSessionId ?? "",
    );
  });
});
