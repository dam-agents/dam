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

// Full-suite-only spec (see playwright.config.ts): it deliberately crosses the
// UI's 60s delivery deadline, so it takes minutes — run on demand with
// `mise run e2e:loop -- --full`.
//
// #829, the core regression. A prompt sent while the previous turn is still
// running is parked by the runtime (`promptQueueBySession`) and legitimately
// produces no content for its sender until that turn ends. The old client
// inferred "not delivered" from "no content within 60s of send", so a prior
// turn outliving the deadline made the delivery indicator lie: a false
// "Couldn't deliver" on a prompt that was sitting safely in the queue and went
// on to be answered normally.
//
// The scripted mock's `delayMs` puts the delay INSIDE the turn, so the runtime
// holds the prompt slot for the whole hold and really does queue prompt B —
// production queueing and promotion code, no test seam.
const promptA = "delivery-a-long-turn";
const promptB = "delivery-b-queued-behind";
const replyHead = "Working on it. ";
const replyTail = "Done with the long turn.";
const replyB = "Answer to the queued prompt.";

test(`a prompt queued behind a >${DELIVERY_TIMEOUT_MS / 1000}s turn never reports a delivery failure (#829)`, async ({
  page,
}) => {
  // Two full turns, the first deliberately longer than the deadline, plus
  // agent boot (up to ~3.5min on a cold pod) and login. Sized above the sum of
  // the individual waits below rather than to the expected runtime — a spec
  // that dies on the harness clock reports as a feature failure, which is the
  // most expensive kind of flake to debug.
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
    // The head chunk proves the turn is genuinely in flight — so prompt B
    // below is queued by the runtime rather than racing an idle session.
    await expect(page.getByText(replyHead.trim())).toBeVisible({
      timeout: 60_000,
    });
  });

  await test.step("a prompt sent mid-turn reports as waiting, not failing", async () => {
    await sendPrompt(page, promptB);
    // Server truth (`platform/promptAccepted` with `queued: true`), so this is
    // a round trip away — not the ~60s the old local guess could take.
    await expect(queuedIndicator(page)).toBeVisible({ timeout: 15_000 });

    // Re-script now, mid-hold, so the promoted prompt gets a SHORT turn with
    // its own reply text — which is what makes the ordering assertion at the
    // end sharp. Safe to swap under the running turn: the mock's script loop
    // iterates the array it started with, so turn A still emits its own tail
    // from the old script, and only B's turn (which begins later, when
    // `advanceQueue` promotes it) reads this one. There is a ~60s margin
    // between this call and that promotion.
    await setMockLongTurnReply(api, agentId, { holdMs: 0, tail: replyB });
  });

  await test.step("no failure is raised while the prior turn runs out", async () => {
    // THE regression assertion. Held open across the 60s boundary by racing
    // the two outcomes: the prior turn's tail arriving (what should happen)
    // against a "Send failed" card appearing (what #829 did). On a build
    // without the feature the card wins this race at ~60s after prompt B's
    // send, well before the tail.
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
    // Order matters: the queued prompt must land after the one it waited for,
    // not spliced into the middle of the streaming reply (the #703 hazard the
    // queued-bubble routing also has to keep satisfying).
    expect(idxB, `prompt B missing or ahead of prompt A`).toBeGreaterThan(idxA);

    expect(rows[idxA + 1]?.role).toBe("assistant");
    expect(rows[idxA + 1]?.text).toContain(replyTail);
    expect(rows[idxB + 1]?.role).toBe("assistant");
    expect(rows[idxB + 1]?.text).toContain(replyB);
  });

  await restoreMockDefaultReply(api, agentId);
});
