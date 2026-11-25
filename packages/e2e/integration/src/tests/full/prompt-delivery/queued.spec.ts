import { expect, test } from "@playwright/test";

import { readChatMessages, setMockLongTurnReply } from "../../../lib/agents.js";
import { createApiClient } from "../../../lib/api-client.js";
import { getAccessToken } from "../../../lib/auth.js";
import {
  DELIVERY_TIMEOUT_MS,
  expectMilestoneBeforeFailure,
  LONG_TURN_MS,
  openMockAgentChat,
  queuedIndicator,
  restoreMockDefaultReply,
  sendPrompt,
} from "./delivery.js";

const promptA = "delivery-a-long-turn";
const promptB = "delivery-b-queued-behind";
const replyHead = "Working on it. ";
const replyTail = "Done with the long turn.";
const replyB = "Answer to the queued prompt.";

test(`a prompt queued behind a >${DELIVERY_TIMEOUT_MS / 1000}s turn never reports a delivery failure (#829)`, async ({
  page,
}) => {
  test.setTimeout(720_000);

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

  await test.step("a prompt sent mid-turn reports as waiting, not failing", async () => {
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

  await test.step("both turns are present, each reply under its own prompt", async () => {
    const rows = await readChatMessages(page);

    const idxA = rows.findIndex(
      (r) => r.role === "user" && r.text.includes(promptA),
    );
    const idxB = rows.findIndex(
      (r) => r.role === "user" && r.text.includes(promptB),
    );
    expect(idxA, `prompt A missing from the transcript`).toBeGreaterThanOrEqual(
      0,
    );
    expect(idxB, `prompt B missing or ahead of prompt A`).toBeGreaterThan(idxA);

    expect(rows[idxA + 1]?.role).toBe("assistant");
    expect(rows[idxA + 1]?.text).toContain(replyTail);
    expect(rows[idxB + 1]?.role).toBe("assistant");
    expect(rows[idxB + 1]?.text).toContain(replyB);
  });

  await restoreMockDefaultReply(api, agentId);
});
