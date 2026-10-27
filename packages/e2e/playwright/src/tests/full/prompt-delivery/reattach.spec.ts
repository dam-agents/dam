import { expect, test } from "@playwright/test";

import { chatInput, setMockLongTurnReply } from "../../../lib/agents.js";
import { createApiClient } from "../../../lib/api-client.js";
import { getAccessToken } from "../../../lib/auth.js";
import {
  expectMilestoneBeforeFailure,
  LONG_TURN_MS,
  openMockAgentChat,
  queuedIndicator,
  restoreMockDefaultReply,
  sendPrompt,
} from "./delivery.js";

const promptA = "reattach-a-long-turn";
const promptB = "reattach-b-after-reload";
const replyHead = "Still working. ";
const replyTail = "Long turn finished after the reload.";
const replyB = "Answer to the post-reload prompt.";

test("a prompt sent after reattaching mid-turn is reported as waiting, not failed (#829)", async ({
  page,
}) => {
  test.setTimeout(840_000);

  const token = await getAccessToken();
  const api = createApiClient(token);

  const agentId = await openMockAgentChat(page, api);

  await test.step("start a turn that outlives the delivery deadline", async () => {
    await setMockLongTurnReply(api, agentId, {
      head: replyHead,
      holdMs: LONG_TURN_MS,
      tail: replyTail,
    });
    await sendPrompt(page, promptA);
    await expect(page.getByText(replyHead.trim())).toBeVisible({
      timeout: 60_000,
    });
  });

  await test.step("reload the tab while the turn is still running", async () => {
    await page.reload();
    await expect(page.getByTestId("app-sidebar")).toBeVisible();
    const sessionRow = page.getByTestId("session-row").first();
    await expect(sessionRow).toBeVisible({ timeout: 60_000 });
    await sessionRow.click();
    await expect(chatInput(page)).toBeVisible();
    await expect(page.getByText(replyHead.trim())).toBeVisible({
      timeout: 60_000,
    });
  });

  await test.step("a prompt sent from the reattached tab reports as waiting", async () => {
    await sendPrompt(page, promptB);
    await expect(queuedIndicator(page)).toBeVisible({ timeout: 15_000 });
    await setMockLongTurnReply(api, agentId, { holdMs: 0, tail: replyB });
  });

  await test.step("no failure is raised while the prior turn runs out", async () => {
    await expectMilestoneBeforeFailure(
      page,
      page.getByText(replyTail),
      LONG_TURN_MS + 60_000,
    );
  });

  await test.step("the queued prompt is promoted and answered", async () => {
    await expect(page.getByText(replyB)).toBeVisible({ timeout: 120_000 });
    await expect(queuedIndicator(page)).toBeHidden();
  });

  await restoreMockDefaultReply(api, agentId);
});
