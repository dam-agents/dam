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
  retryButton,
  sendPrompt,
} from "./delivery.js";

// Full-suite-only spec (see playwright.config.ts): the turn deliberately stays
// silent past the 60s deadline, so it takes minutes.
//
// The third of the three states a bubble can be in when the connection dies,
// and the one the other specs don't reach: the turn STARTED but has not yet
// produced its first chunk. Queued-at-drop is the disconnect spec (a real
// loss — the runtime discards a detached channel's queue), content-at-drop is
// plain reconnect-and-resume; this one sits in between. The prompt is already
// forwarded, so the agent keeps the turn and finishes it (`detach()` discards
// only queued prompts) — but the client guards used to key on "has content" /
// "is queued", and a started-but-silent bubble satisfied neither:
// `conn.prompt()`'s rejection fell through to the raw SDK wording
// ("Connection closed while request was in flight") with a Retry that would
// re-run a prompt the agent already ran, right next to the reply the replay
// then delivered.
const promptA = "silent-turn-a-dropped-mid-hold";
const replyTail = "Done after the silent hold.";

test("a turn that started but streamed nothing survives a dropped connection without a failure card (#829)", async ({
  page,
}) => {
  // Boot + login, a silent hold past the 60s deadline, then a reconnect on the
  // backoff ladder (1s…30s) plus history replay. Sized above the sum of those
  // waits, not the expected runtime.
  test.setTimeout(720_000);

  const token = await getAccessToken();
  const api = createApiClient(token);

  // Before any navigation — see the disconnect spec: `setOffline` leaves
  // established sockets open, so the close handling under test would not run.
  await trackWebSockets(page);

  const agentId = await openMockAgentChat(page, api);

  await test.step("start a turn that stays silent", async () => {
    // No head chunk: nothing streams until the hold expires, so the bubble is
    // still empty the whole time the socket is down.
    await setMockLongTurnReply(api, agentId, {
      holdMs: LONG_TURN_MS,
      tail: replyTail,
    });
    await sendPrompt(page, promptA);
  });

  await test.step("drop the connection once the agent holds the turn", async () => {
    // The event anchor for "the turn started": the mock reporting the prompt
    // proves the runtime forwarded it (`promptStarted` fires on that same
    // handoff), yet no content chunk exists — exactly the started-but-silent
    // state. Without this the drop could race the send and sever the socket
    // before the prompt frame ever reaches the runtime.
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
    // THE assertion. On the old guards the "Send failed" card wins this race
    // within milliseconds of the drop — `conn.prompt()` rejects as the socket
    // dies. Now nothing may surface while the turn runs out silently: the
    // client reconnects on its own backoff, the replay picks the turn back
    // up, and the reply arriving first is the proof.
    await expectMilestoneBeforeFailure(
      page,
      page.getByText(replyTail),
      LONG_TURN_MS + 180_000,
    );
  });

  await test.step("the turn reads as an ordinary exchange after replay", async () => {
    // The user's message survived the rebuild with its reply under it, and no
    // Retry is on offer — retrying would double-run a prompt the agent
    // already answered.
    await expect(page.getByText(promptA)).toBeVisible();
    await expect(deliveryError(page)).toBeHidden();
    await expect(retryButton(page)).toBeHidden();
  });

  await restoreMockDefaultReply(api, agentId);
});
