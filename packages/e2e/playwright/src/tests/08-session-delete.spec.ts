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
    await page.goto(baseUrl);
    await expect(page.getByTestId("app-sidebar")).toBeVisible();
    await expect(agentCardStatus(page, agentName, "Running")).toBeVisible();
    await gotoAgentDetail(page, agentName, agentId);
    await expect(page.getByPlaceholder(/message agent/i)).toBeVisible();

    await sendMessageToAgent(page, firstPrompt);
    await expect(page.getByText(scriptedReply)).toBeVisible({
      timeout: 30_000,
    });
  });

  // The session we just engaged is the active one. Capture its id so the
  // assertion targets that specific row regardless of any other sessions
  // earlier specs may have left in the sidebar.
  const activeRow = page.locator(activeRowSelector);
  await expect(activeRow).toHaveCount(1);
  const deletedSessionId = await activeRow.getAttribute("data-session-id");
  expect(deletedSessionId).toBeTruthy();
  const deletedRow = page.locator(
    `[data-testid="session-row"][data-session-id="${deletedSessionId}"]`,
  );

  await test.step("(A) deleting the active session removes it without a refresh", async () => {
    await activeRow.hover();
    await activeRow.getByTestId("session-delete-button").click();
    await page
      .getByRole("alertdialog")
      .getByRole("button", { name: "Confirm" })
      .click();
    await expect(page.getByText("Session deleted")).toBeVisible();
    // No page.reload() / no sidebar refresh: the row must vanish on its own.
    await expect(deletedRow).toHaveCount(0);
  });

  await test.step("(B) a session started right after the delete appears in the sidebar", async () => {
    await expect(page.getByPlaceholder(/message agent/i)).toBeVisible();
    await sendMessageToAgent(page, secondPrompt);
    await expect(page.getByText(scriptedReply)).toBeVisible({
      timeout: 30_000,
    });
    // A new active session row exists, and it is not the deleted one.
    const freshRow = page.locator(activeRowSelector);
    await expect(freshRow).toHaveCount(1);
    await expect(freshRow).not.toHaveAttribute(
      "data-session-id",
      deletedSessionId ?? "",
    );
  });
});
