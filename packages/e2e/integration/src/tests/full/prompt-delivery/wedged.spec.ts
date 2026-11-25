import { test } from "@playwright/test";

import { setMockLongTurnReply } from "../../../lib/agents.js";
import { createApiClient } from "../../../lib/api-client.js";
import { getAccessToken } from "../../../lib/auth.js";
import {
  expectMilestoneBeforeFailure,
  LONG_TURN_MS,
  openMockAgentChat,
  restoreMockDefaultReply,
  sendPrompt,
} from "./delivery.js";

const REMOVED_SILENCE_DEADLINE_MS = 60_000;

const prompt = "wedged-agent-no-content";
const lateReply = "A slow first word is not a failure.";

test(`a prompt handed to an agent that stays silent past ${REMOVED_SILENCE_DEADLINE_MS / 1000}s reports no failure (#3058)`, async ({
  page,
}) => {
  test.setTimeout(480_000);

  const token = await getAccessToken();
  const api = createApiClient(token);

  const agentId = await openMockAgentChat(page, api);

  await test.step("send into an idle session an agent that answers nothing for a while", async () => {
    await setMockLongTurnReply(api, agentId, {
      holdMs: LONG_TURN_MS,
      tail: lateReply,
    });
    await sendPrompt(page, prompt);
  });

  await test.step("the reply lands with no delivery failure on the way", async () => {
    await expectMilestoneBeforeFailure(
      page,
      page.getByText(lateReply),
      LONG_TURN_MS + 120_000,
    );
  });

  await restoreMockDefaultReply(api, agentId);
});
