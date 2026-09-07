import { expect, test } from "@playwright/test";

import { readChatMessages, setMockLongTurnReply } from "../../../lib/agents.js";
import { createApiClient } from "../../../lib/api-client.js";
import { getAccessToken } from "../../../lib/auth.js";
import {
  bubbleImage,
  LONG_TURN_MS,
  openMockAgentChat,
  QUEUE_PARK_MS,
  queuedIndicator,
  reopenMockAgentChat,
  restoreMockDefaultReply,
  retryUndelivered,
  sendPrompt,
  sendPromptWithImage,
  undeliveredBubble,
  undeliveredMarker,
} from "./delivery.js";

const PARK_MARGIN_MS = 7_000;

const promptA = "undelivered-a-long-turn";
const promptB = "undelivered-b-queued-text";
const promptC = "undelivered-c-queued-with-image";
const replyHead = "Taking a while. ";
const replyTail = "Long turn finished.";
const replyC = "Answer to the resent prompt.";

test(`queued prompts outlive an abandoned tab and can be sent again, image and all (#3264)`, async ({
  page,
  context,
}) => {
  test.setTimeout(900_000);

  const token = await getAccessToken();
  const api = createApiClient(token);

  const agentId = await openMockAgentChat(page, api);

  await test.step("queue two prompts behind a long turn, one carrying an image", async () => {
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
    await expect(queuedIndicator(page).first()).toBeVisible({
      timeout: 15_000,
    });
    await sendPromptWithImage(page, promptC);
    await expect(queuedIndicator(page)).toHaveCount(2, { timeout: 15_000 });
  });

  await test.step("close the tab and stay away past the park window", async () => {
    await page.close();
    await new Promise((resolve) =>
      setTimeout(resolve, QUEUE_PARK_MS + PARK_MARGIN_MS),
    );
  });

  const revisit = await context.newPage();

  await test.step("both prompts come back marked undelivered, in the order they were sent", async () => {
    await reopenMockAgentChat(revisit, agentId);
    await expect(undeliveredMarker(revisit)).toHaveCount(2, {
      timeout: 120_000,
    });

    const rows = await readChatMessages(revisit);
    const idxB = rows.findIndex((r) => r.text.includes(promptB));
    const idxC = rows.findIndex((r) => r.text.includes(promptC));
    expect(idxB, "prompt B missing after the revisit").toBeGreaterThanOrEqual(
      0,
    );
    expect(idxC, "prompt C missing or ahead of prompt B").toBeGreaterThan(idxB);

    await expect(undeliveredMarker(revisit).first()).toContainText(
      /not delivered/i,
    );
  });

  await test.step("the recovered prompt still carries its image", async () => {
    await expect(
      bubbleImage(undeliveredBubble(revisit, promptC)),
    ).toBeVisible();
  });

  await test.step("a second visit still finds them — handing them back does not consume them", async () => {
    await reopenMockAgentChat(revisit, agentId);
    await expect(undeliveredMarker(revisit)).toHaveCount(2, {
      timeout: 120_000,
    });
  });

  await test.step("Retry sends the image prompt for real and the original bubble goes", async () => {
    await setMockLongTurnReply(api, agentId, { holdMs: 0, tail: replyC });
    const bubble = undeliveredBubble(revisit, promptC);
    await retryUndelivered(revisit, bubble);

    await expect(revisit.getByText(replyC)).toBeVisible({ timeout: 120_000 });
    await expect(undeliveredBubble(revisit, promptC)).toHaveCount(0);
    await expect(undeliveredMarker(revisit)).toHaveCount(1);
  });

  await test.step("the resent prompt kept its image, and the one left alone is still undelivered", async () => {
    const resent = revisit
      .getByTestId("chat-message")
      .filter({ hasText: promptC });
    await expect(bubbleImage(resent).first()).toBeVisible();

    await reopenMockAgentChat(revisit, agentId);
    await expect(undeliveredBubble(revisit, promptB)).toHaveCount(1, {
      timeout: 120_000,
    });
    await expect(undeliveredBubble(revisit, promptC)).toHaveCount(0);
  });

  await test.step("the retried prompt appears once — its failed original does not replay", async () => {
    await expect(
      revisit
        .getByTestId("chat-message")
        .filter({ has: revisit.getByText(promptC, { exact: false }) }),
    ).toHaveCount(1);
  });

  await test.step("no stale waiting bubble trails the recovered message once the turn is over", async () => {
    const rows = await readChatMessages(revisit);
    const idxB = rows.findIndex(
      (r) => r.role === "user" && r.text.includes(promptB),
    );
    expect(idxB).toBeGreaterThanOrEqual(0);
    const after = rows[idxB + 1];
    expect(
      after === undefined ||
        after.role !== "assistant" ||
        after.text.trim() !== "",
      "the recovered prompt's queued placeholder must not survive as a blank agent row",
    ).toBe(true);
  });

  await restoreMockDefaultReply(api, agentId);
});
