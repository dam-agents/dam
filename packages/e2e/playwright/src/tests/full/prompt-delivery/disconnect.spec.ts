import { expect, test } from "@playwright/test";

import { setMockLongTurnReply } from "../../../lib/agents.js";
import { createApiClient } from "../../../lib/api-client.js";
import { getAccessToken } from "../../../lib/auth.js";
import {
  deliveryError,
  LONG_TURN_MS,
  openMockAgentChat,
  queuedIndicator,
  restoreMockDefaultReply,
  retryUndelivered,
  sendPrompt,
  undeliveredBubble,
  undeliveredMarker,
} from "./delivery.js";
import { dropWebSockets, trackWebSockets } from "../../../lib/network.js";

const promptA = "disconnect-a-long-turn";
const promptB = "disconnect-b-queued-then-dropped";
const replyHead = "Holding the turn open. ";
const replyTail = "Long turn done.";
const replyRetry = "Answer to the retried prompt.";

test("a prompt queued when the connection drops is marked undelivered, and the mark survives reconnect (#829)", async ({
  page,
}) => {
  test.setTimeout(960_000);

  const token = await getAccessToken();
  const api = createApiClient(token);

  await trackWebSockets(page);

  const agentId = await openMockAgentChat(page, api);

  await test.step("queue a prompt behind a long-running turn", async () => {
    await setMockLongTurnReply(api, agentId, {
      head: replyHead,
      holdMs: LONG_TURN_MS,
      tail: replyTail,
    });
    await sendPrompt(page, promptA);
    await expect(page.getByText(replyHead.trim())).toBeVisible({
      timeout: 60_000,
    });

    await sendPrompt(page, promptB);
    await expect(queuedIndicator(page)).toBeVisible({ timeout: 15_000 });
  });

  await test.step("losing the connection marks the queued prompt undelivered", async () => {
    await dropWebSockets(page);

    const bubble = undeliveredBubble(page, promptB);
    await expect(bubble).toHaveCount(1, { timeout: 60_000 });
    await expect(undeliveredMarker(page)).toContainText(
      /connection dropped while this prompt was still waiting/i,
    );
    await expect(deliveryError(page)).toBeHidden();
    await expect(queuedIndicator(page)).toBeHidden();
  });

  await test.step("the mark is still there after the tab reconnects", async () => {
    await expect(undeliveredBubble(page, promptB)).toHaveCount(1, {
      timeout: 180_000,
    });
    await expect(page.getByText(replyTail)).toBeVisible({ timeout: 180_000 });
    await expect(undeliveredBubble(page, promptB)).toHaveCount(1);
  });

  await test.step("Retry re-sends the prompt and the reply arrives", async () => {
    await setMockLongTurnReply(api, agentId, { holdMs: 0, tail: replyRetry });
    await retryUndelivered(page, undeliveredBubble(page, promptB));
    await expect(page.getByText(replyRetry)).toBeVisible({ timeout: 120_000 });
    await expect(undeliveredMarker(page)).toHaveCount(0);
  });

  await restoreMockDefaultReply(api, agentId);
});
