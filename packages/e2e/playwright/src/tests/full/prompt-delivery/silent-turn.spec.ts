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
  restoreMockDefaultReply,
  sendPrompt,
} from "./delivery.js";

const promptA = "silent-turn-a-dropped-mid-hold";
const replyTail = "Done after the silent hold.";

test("a turn that started but streamed nothing survives a dropped connection without a failure card (#829)", async ({
  page,
}) => {
  test.setTimeout(720_000);

  const token = await getAccessToken();
  const api = createApiClient(token);

  await trackWebSockets(page);

  const agentId = await openMockAgentChat(page, api);

  await test.step("start a turn that stays silent", async () => {
    await setMockLongTurnReply(api, agentId, {
      holdMs: LONG_TURN_MS,
      tail: replyTail,
    });
    await sendPrompt(page, promptA);
  });

  await test.step("drop the connection once the agent holds the turn", async () => {
    await expect
      .poll(
        async () => {
          const { prompts } = await api.e2e.getReceivedPrompts.query({
            agentId,
          });
          return JSON.stringify(prompts);
        },
        { timeout: 30_000 },
      )
      .toContain(promptA);

    await dropWebSockets(page);
  });

  await test.step("the reply arrives with no failure raised on the way", async () => {
    await expectMilestoneBeforeFailure(
      page,
      page.getByText(replyTail),
      LONG_TURN_MS + 180_000,
    );
  });

  await test.step("the turn reads as an ordinary exchange after replay", async () => {
    await expect(page.getByText(promptA)).toBeVisible();
    await expect(deliveryError(page)).toBeHidden();
  });

  await restoreMockDefaultReply(api, agentId);
});
