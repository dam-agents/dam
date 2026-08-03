import { expect, test } from "@playwright/test";

import { chatInput, setMockLongTurnReply } from "../../lib/agents.js";
import { createApiClient } from "../../lib/api-client.js";
import { getAccessToken } from "../../lib/auth.js";
import {
  expectMilestoneBeforeFailure,
  LONG_TURN_MS,
  openMockAgentChat,
  queuedIndicator,
  restoreMockDefaultReply,
  sendPrompt,
} from "../../lib/delivery.js";

// Full-suite-only spec (see playwright.config.ts): crosses the UI's 60s
// delivery deadline, so it takes minutes.
//
// #829 as literally reported: come back to a session whose turn is still
// running (a backgrounded tab, or scheduled background work) and send a
// prompt. The reload is what made the old client certain to lie — it rebuilt
// its state from the runtime log, which carries no "a turn is in flight" flag
// for a reload to recover, so the fresh client had no local streaming state to
// guess from and treated the mid-turn send as a first send into an idle
// session. Sixty seconds of legitimate queueing later: "Couldn't deliver".
//
// The fix makes it moot — `platform/promptAccepted { queued: true }` is the
// runtime's answer to a question the client no longer tries to answer itself —
// and this spec is the proof that the reconnected client gets it too, not just
// the one that watched the turn start.
const promptA = "reattach-a-long-turn";
const promptB = "reattach-b-after-reload";
const replyHead = "Still working. ";
const replyTail = "Long turn finished after the reload.";
const replyB = "Answer to the post-reload prompt.";

test("a prompt sent after reattaching mid-turn is reported as waiting, not failed (#829)", async ({
  page,
}) => {
  // Above the sum of the waits below (boot + login + reload/replay + a turn
  // that outlives the 60s deadline + the promoted turn), not the expected
  // runtime: dying on the harness clock would read as a feature failure.
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
    // A cold load lands on the agent's chat route but with no session bound —
    // the session has to be picked back up from the sidebar, which is exactly
    // what a user returning to a backgrounded tab does. Its row is the one the
    // runtime reports as active.
    await expect(page.getByTestId("app-sidebar")).toBeVisible();
    // Newest first, and this spec's is the only session on the shared agent
    // with a turn in flight — the smoke chain's sessions are all finished.
    const sessionRow = page.getByTestId("session-row").first();
    await expect(sessionRow).toBeVisible({ timeout: 60_000 });
    await sessionRow.click();
    await expect(chatInput(page)).toBeVisible();
    // History replay brings the in-flight turn's head back; the reply itself
    // resumes streaming over the freshly attached channel.
    await expect(page.getByText(replyHead.trim())).toBeVisible({
      timeout: 60_000,
    });
  });

  await test.step("a prompt sent from the reattached tab reports as waiting", async () => {
    await sendPrompt(page, promptB);
    // The reattached client has no local memory of the running turn — this
    // indicator is only possible because the runtime told it.
    await expect(queuedIndicator(page)).toBeVisible({ timeout: 15_000 });
    // Short turn for the promotion, swapped in mid-hold (see the queued spec:
    // the mock's script loop iterates the array it started the turn with).
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
