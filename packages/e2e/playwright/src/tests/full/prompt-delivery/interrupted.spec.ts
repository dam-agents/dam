import { expect, test, type Page } from "@playwright/test";

import { createApiClient } from "../../../lib/api-client.js";
import { getAccessToken } from "../../../lib/auth.js";
import {
  deliveryError,
  openMockAgentChat,
  reopenMockAgentChat,
  sendPrompt,
} from "./delivery.js";

const failingPrompt = "interrupted-reply __FAIL_MIDTURN__";
const partialReply = "partial reply before the failure";
const failure = "simulated model failure";

async function expectInterruptedReply(page: Page): Promise<void> {
  await expect(page.getByText(partialReply)).toBeVisible({ timeout: 60_000 });
  await expect(deliveryError(page)).toContainText("Response interrupted:");
  await expect(deliveryError(page)).toContainText(failure);
}

test("a reply cut short by a failed turn still reads as interrupted after a reload and in another tab (#3557)", async ({
  page,
  context,
}) => {
  test.setTimeout(600_000);

  const api = createApiClient(await getAccessToken());
  const agentId = await openMockAgentChat(page, api);

  await test.step("the sender sees the partial reply marked interrupted", async () => {
    await sendPrompt(page, failingPrompt);
    await expectInterruptedReply(page);
  });

  await test.step("a reload replays the reply still marked interrupted", async () => {
    await reopenMockAgentChat(page, agentId);
    await expectInterruptedReply(page);
  });

  await test.step("another tab opening the conversation sees it marked too", async () => {
    const other = await context.newPage();
    await reopenMockAgentChat(other, agentId);
    await expectInterruptedReply(other);
    await other.close();
  });
});
