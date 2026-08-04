import { expect, test } from "@playwright/test";

import { setMockLongTurnReply } from "../../../lib/agents.js";
import { createApiClient } from "../../../lib/api-client.js";
import { getAccessToken } from "../../../lib/auth.js";
import {
  deliveryError,
  DELIVERY_TIMEOUT_MS,
  LONG_TURN_MS,
  openMockAgentChat,
  queuedIndicator,
  restoreMockDefaultReply,
  retryButton,
  sendPrompt,
} from "./delivery.js";

// Full-suite-only spec (see playwright.config.ts): waits out the UI's 60s
// deadline on purpose.
//
// The counterpart to the queued specs. Making waiting-in-a-queue unbounded
// must not cost us the check the original watchdog was really after: an agent
// that took the prompt and then said nothing. The fix doesn't remove that
// check, it re-anchors it — from "60s after send" (which couldn't tell queueing
// apart from silence) to "60s after `platform/promptStarted`", the point where
// the runtime confirms the agent has the prompt and content is genuinely owed.
//
// Scripted as a turn whose only entry is delayed: the mock accepts the prompt
// and emits nothing at all until the delay elapses. To the client that is
// indistinguishable from a wedged agent, which is the point — and it is sent
// into an IDLE session, so there is no queueing anywhere in the picture and the
// only clock that can fire is started→content.
const prompt = "wedged-agent-no-content";
const lateReply = "Eventually, a reply nobody is waiting for.";

test(`a prompt handed to an agent that then goes silent fails at ~${DELIVERY_TIMEOUT_MS / 1000}s (#829)`, async ({
  page,
}) => {
  // Boot + login, then the full 60s deadline, then waiting out the mock's late
  // chunk before the recovery send. Sized above the sum of those waits.
  test.setTimeout(720_000);

  const token = await getAccessToken();
  const api = createApiClient(token);

  const agentId = await openMockAgentChat(page, api);

  await test.step("send into an idle session an agent that answers nothing", async () => {
    await setMockLongTurnReply(api, agentId, {
      holdMs: LONG_TURN_MS,
      tail: lateReply,
    });
    await sendPrompt(page, prompt);
    // Never queued: the session is idle, so the runtime hands the prompt
    // straight to the agent (`promptAccepted { queued: false }` then
    // `promptStarted`). If this indicator ever showed here, the failure below
    // would be proving the wrong clock.
    await expect(queuedIndicator(page)).toBeHidden();
  });

  await test.step("the failure appears once the content deadline passes", async () => {
    // Timed rather than merely awaited. `expect(...).toBeHidden()` would pass
    // the instant the card is absent — vacuous here — and a bare wait would
    // accept a card that fired far too early. Measuring the interval is what
    // pins the failure to the deadline: a slow-but-alive agent has to be given
    // its full 60s, and the turn's own content is still ~15s beyond that, so a
    // card inside this window can only be the deadline firing.
    const sentAt = Date.now();
    await deliveryError(page).waitFor({
      state: "visible",
      timeout: DELIVERY_TIMEOUT_MS + 30_000,
    });
    const elapsedMs = Date.now() - sentAt;
    // Generous floor, not a tight one: the clock starts at `promptStarted`,
    // which is a round trip after the send this measures from, and the spec
    // must not go flaky over a slow cluster. It still catches the failure mode
    // that matters — a watchdog that fires long before the deadline.
    expect(
      elapsedMs,
      `delivery failure fired after ${elapsedMs}ms — too early to be the ` +
        `${DELIVERY_TIMEOUT_MS}ms started→content deadline`,
    ).toBeGreaterThan(DELIVERY_TIMEOUT_MS * 0.7);
    await expect(deliveryError(page)).toContainText("Send failed");
    // The wedged-agent wording, not the dropped-from-the-queue one: nothing
    // was queued and the connection never went away.
    await expect(deliveryError(page)).toContainText(
      /couldn't deliver.*didn't respond/i,
    );
    await expect(retryButton(page)).toBeVisible();
  });

  await test.step("a Retry after the agent recovers gets its reply", async () => {
    // The mock isn't really wedged — its late chunk lands eventually. Wait it
    // out before retrying so the retried prompt isn't queued behind that turn,
    // which would make this step assert queueing rather than recovery.
    await expect(page.getByText(lateReply)).toBeVisible({ timeout: 120_000 });

    const recoveredReply = "Answer after the agent recovered.";
    await setMockLongTurnReply(api, agentId, {
      holdMs: 0,
      tail: recoveredReply,
    });
    await retryButton(page).click();
    await expect(page.getByText(recoveredReply)).toBeVisible({
      timeout: 120_000,
    });
  });

  await restoreMockDefaultReply(api, agentId);
});
