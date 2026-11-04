import { expect, test } from "@playwright/test";

import {
  readChatMessages,
  setMockLongTurnReply,
  sidebarAgentRow,
} from "../../../lib/agents.js";
import { createApiClient } from "../../../lib/api-client.js";
import { getAccessToken } from "../../../lib/auth.js";
import {
  openMockAgentChat,
  queuedIndicator,
  restoreMockDefaultReply,
  sendPrompt,
  undeliveredMarker,
} from "./delivery.js";

// TEST_OVERVIEW: a person sends a message while the agent is still busy, opens another session before the reply comes, and returns two minutes later. The runtime accepted the message, so it runs while nobody watches the session, and the person comes back to its answer rather than to a "Not delivered" mark (#6227).

const agentName = "e2e-delivery";
const promptA = "left-chat-a-long-turn";
const promptB = "left-chat-b-sent-before-leaving";
const replyHead = "Busy with the first message. ";
const replyB = "Answer to the message sent before leaving.";
const AWAY_MS = 120_000;
const activeRowSelector = '[data-testid="session-row"][data-active="true"]';

test("a message sent before leaving the chat runs while the person is away (#6227)", async ({
  page,
}) => {
  test.setTimeout(600_000);

  const api = createApiClient(await getAccessToken());
  const agentId = await openMockAgentChat(page, api);

  await test.step("send a message behind a turn that is still running", async () => {
    await setMockLongTurnReply(api, agentId, {
      head: replyHead,
      holdMs: 30_000,
      tail: "First message done.",
    });
    await sendPrompt(page, promptA);
    await expect(page.getByText(replyHead.trim())).toBeVisible({
      timeout: 60_000,
    });
    await sendPrompt(page, promptB);
    await expect(queuedIndicator(page)).toBeVisible({ timeout: 15_000 });
    await setMockLongTurnReply(api, agentId, { holdMs: 0, tail: replyB });
  });

  const sessionId = await page
    .locator(activeRowSelector)
    .getAttribute("data-session-id");
  expect(sessionId, "the first session has no row").toBeTruthy();
  const sessionRow = page.locator(
    `[data-testid="session-row"][data-session-id="${sessionId ?? ""}"]`,
  );

  await test.step("open a new session and stay there for two minutes", async () => {
    await sidebarAgentRow(page, agentName)
      .getByRole("button", { name: "New session" })
      .click();
    await expect(page.getByText(promptB)).toBeHidden();
    await page.waitForTimeout(AWAY_MS);
  });

  await test.step("come back to the answer, with nothing marked undelivered", async () => {
    await sessionRow.click();
    await expect(page.getByText(replyB)).toBeVisible({ timeout: 60_000 });
    await expect(undeliveredMarker(page)).toHaveCount(0);

    const rows = await readChatMessages(page);
    const idxB = rows.findIndex(
      (r) => r.role === "user" && r.text.includes(promptB),
    );
    expect(idxB, "the message sent before leaving is missing").toBeGreaterThan(
      -1,
    );
    expect(rows[idxB + 1]?.text).toContain(replyB);
  });

  await restoreMockDefaultReply(api, agentId);
});
