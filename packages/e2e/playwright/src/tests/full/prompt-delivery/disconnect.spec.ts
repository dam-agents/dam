import { expect, test } from "@playwright/test";

import { setMockLongTurnReply } from "../../../lib/agents.js";
import { createApiClient } from "../../../lib/api-client.js";
import { getAccessToken } from "../../../lib/auth.js";
import { dropWebSockets, trackWebSockets } from "../../../lib/network.js";
import {
  deliveryError,
  expectMilestoneBeforeFailure,
  LONG_TURN_MS,
  openMockAgentChat,
  queuedIndicator,
  restoreMockDefaultReply,
  sendPrompt,
  undeliveredMarker,
} from "./delivery.js";

const promptA = "disconnect-a-long-turn";
const promptB = "disconnect-b-queued-through-drop";
const replyHead = "Holding the turn open. ";
const replyTail = "Long turn done.";
const replyB = "Answer to the queued prompt.";

test("a prompt queued when the connection drops is delivered after the tab reconnects (#3264)", async ({
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

    await setMockLongTurnReply(api, agentId, { holdMs: 0, tail: replyB });
  });

  await test.step("losing the connection raises nothing — the queue is parked", async () => {
    await dropWebSockets(page);
    await expect(deliveryError(page)).toBeHidden();
    await expect(undeliveredMarker(page)).toHaveCount(0);
  });

  await test.step("the tab reconnects and the prompt reads as queued again", async () => {
    await expect(queuedIndicator(page)).toBeVisible({ timeout: 60_000 });
    await expect(undeliveredMarker(page)).toHaveCount(0);
  });

  await test.step("no failure is raised while the prior turn runs out", async () => {
    await expectMilestoneBeforeFailure(
      page,
      page.getByText(replyTail),
      LONG_TURN_MS + 180_000,
    );
  });

  await test.step("the queued prompt is promoted and answered as an ordinary turn", async () => {
    await expect(page.getByText(replyB)).toBeVisible({ timeout: 120_000 });
    await expect(page.getByText(promptB)).toBeVisible();
    await expect(undeliveredMarker(page)).toHaveCount(0);
    await expect(queuedIndicator(page)).toBeHidden();
  });

  await restoreMockDefaultReply(api, agentId);
});
