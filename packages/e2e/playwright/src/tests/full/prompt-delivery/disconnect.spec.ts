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
  retryButton,
  sendPrompt,
} from "./delivery.js";
import { dropWebSockets, trackWebSockets } from "../../../lib/network.js";

// Full-suite-only spec (see playwright.config.ts). The other side of the
// feature: the delivery indicator must not lie in EITHER direction, so a
// prompt the platform really did drop has to fail loudly.
//
// This is the one delivery failure the runtime cannot report. A channel's
// queued prompts are discarded when it detaches (`acp-runtime.ts` `detach()`),
// and by then there is no channel left to send a notification on — so the
// client raises this failure itself, from the WS close handler. Before the fix
// the prompt vanished in silence: the bubble closed empty and the user was left
// waiting on an answer that could never come.
//
// The reconnect half is the subtle part. Reattaching replays the runtime log,
// which holds the dropped prompt's user-message echo and no reply — so a plain
// rebuild would erase the failure card and its Retry, putting the user right
// back in front of the silent-loss bug. `mergeLocalFailures` carries it across,
// and that is the seam most likely to regress.
const promptA = "disconnect-a-long-turn";
const promptB = "disconnect-b-queued-then-dropped";
const replyHead = "Holding the turn open. ";
const replyTail = "Long turn done.";
const replyRetry = "Answer to the retried prompt.";

test("a prompt queued when the connection drops fails with Retry, and the failure survives reconnect (#829)", async ({
  page,
}) => {
  // The longest spec in the set: boot + login, a turn past the 60s deadline,
  // then a reconnect that runs on a backoff ladder (1s…30s) and has to replay
  // history before the surviving-failure assertions can settle. Sized above
  // the sum of those waits, not the expected runtime.
  test.setTimeout(960_000);

  const token = await getAccessToken();
  const api = createApiClient(token);

  // Before any navigation: the connection is severed below by closing the
  // page's WebSockets directly. `context.setOffline` can't do it — Chromium's
  // offline emulation leaves established sockets open, so the close handler
  // under test would never run.
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

  await test.step("losing the connection fails the queued prompt with Retry", async () => {
    // Closing the WS is what makes the runtime detach this channel and drop
    // prompt B — the real loss, not a simulated one. The client's close
    // handler is what turns it into a visible failure.
    await dropWebSockets(page);

    await expect(deliveryError(page)).toBeVisible({ timeout: 60_000 });
    await expect(deliveryError(page)).toContainText("Send failed");
    // Wording is the server-can't-tell-you case specifically, not the generic
    // "the agent didn't respond" a deadline would have produced
    // (`QUEUED_LOST_MESSAGE`).
    await expect(deliveryError(page)).toContainText(
      /connection dropped while this prompt was still waiting/i,
    );
    // Retry is always offered, and is always a fresh send — never an
    // auto-resend, which could double-deliver.
    await expect(retryButton(page)).toBeVisible();
    // The bubble stops claiming to be waiting: it is decided, not pending.
    await expect(queuedIndicator(page)).toBeHidden();
  });

  await test.step("the failure is still there after the tab reconnects", async () => {
    // The network never actually went down, so the client reconnects on its
    // own backoff — no flag to flip. The reconnect replays history and
    // rebuilds the message list. The card has to outlive that rebuild — the
    // assertion that `mergeLocalFailures` is doing its job. Generous:
    // reconnect runs on a backoff (1s…30s) and has to wait for the long
    // turn's socket work to settle.
    await expect(deliveryError(page)).toBeVisible({ timeout: 180_000 });
    await expect(retryButton(page)).toBeVisible();
    // Not just surviving the first rebuild — still there once the replayed
    // turn has fully landed, which is when a late `setMessages(fresh)` would
    // have clobbered it.
    await expect(page.getByText(replyTail)).toBeVisible({ timeout: 180_000 });
    await expect(deliveryError(page)).toBeVisible();
    await expect(retryButton(page)).toBeVisible();
  });

  await test.step("Retry re-sends the prompt and the reply arrives", async () => {
    await setMockLongTurnReply(api, agentId, { holdMs: 0, tail: replyRetry });
    await retryButton(page).click();
    await expect(page.getByText(replyRetry)).toBeVisible({ timeout: 120_000 });
    // A fresh send strips the previous failure's Retry (only the latest
    // failure offers one), and this send succeeded — so no Retry is left.
    await expect(retryButton(page)).toBeHidden();
  });

  await restoreMockDefaultReply(api, agentId);
});
