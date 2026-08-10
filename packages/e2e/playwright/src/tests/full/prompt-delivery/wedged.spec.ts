import { test } from "@playwright/test";

import { setMockLongTurnReply } from "../../../lib/agents.js";
import { createApiClient } from "../../../lib/api-client.js";
import { getAccessToken } from "../../../lib/auth.js";
import {
  DELIVERY_TIMEOUT_MS,
  expectMilestoneBeforeFailure,
  LONG_TURN_MS,
  openMockAgentChat,
  restoreMockDefaultReply,
  sendPrompt,
} from "./delivery.js";

// Full-suite-only spec (see playwright.config.ts): waits out the UI's former
// 60s content deadline on purpose.
//
// An agent that took the prompt and then says nothing is indistinguishable
// from one that is merely slow — thinking and tool use produce no content
// either. #3058 decided that guessing is worse than waiting: a slow first word
// used to earn a red "Send failed" card beside a turn that was working fine,
// which taught people to distrust the signal. So the started→content deadline
// is gone, and this spec holds that line.
//
// Scripted as a turn whose only entry is delayed past the old deadline: the
// mock accepts the prompt and emits nothing until the delay elapses. Sent into
// an IDLE session, so nothing is queued anywhere and the old clock would have
// been the only thing that could fire.
const prompt = "wedged-agent-no-content";
const lateReply = "A slow first word is not a failure.";

test(`a prompt handed to an agent that stays silent past ${DELIVERY_TIMEOUT_MS / 1000}s reports no failure (#3058)`, async ({
  page,
}) => {
  // Boot + login, then the mock's full hold, then the reply. Sized above the sum.
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
    // Raced rather than awaited: whichever of the two appears first decides, so
    // the assertion is held open across the old 60s boundary instead of passing
    // the instant no card is present.
    await expectMilestoneBeforeFailure(
      page,
      page.getByText(lateReply),
      LONG_TURN_MS + 120_000,
    );
  });

  await restoreMockDefaultReply(api, agentId);
});
