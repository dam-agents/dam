import { expect, test } from "@playwright/test";
import { connectionEgressPlaceholder } from "api-server-api";

import { waitForAgentRunning } from "../../lib/agents.js";
import { createApiClient } from "../../lib/api-client.js";
import { getAccessToken } from "../../lib/auth.js";
import { getConnectionId } from "../../lib/connections.js";
import {
  agentName,
  connectionName,
  echoUrl,
  sentinel,
} from "../../lib/fixtures.js";
import { connectSlackAsMember } from "../../lib/slack.js";

const sharedChannelId = "C-E2E-SHARED";
const strangerSlackUserId = "U-E2E-STRANGER";
const fetchTurnAttempts = 5;

// TEST_OVERVIEW: a turn a Slack member who is not the owner starts runs under the owner's credentials: the gateway puts the owner's connection on the agent's request. That a member's mention reaches the agent and is answered in its thread is an Example of the acceptance suite (features/slack/members.feature).
test("shared turns run under the OWNER's credentials whoever asked", async () => {
  test.setTimeout(240_000);

  const token = await getAccessToken();
  const api = createApiClient(token);
  const agentId = await waitForAgentRunning(api, agentName);
  await connectSlackAsMember(api, {
    id: agentId,
    slackChannelId: sharedChannelId,
  });
  const placeholder = connectionEgressPlaceholder(
    await getConnectionId(api, connectionName),
  );

  await test.step("a stranger's fetch turn carries the owner's credential", async () => {
    await api.e2e.slackResetOutbound.mutate();

    let turnsFired = 0;
    await expect
      .poll(
        async () => {
          const { records } = await api.e2e.slackReadOutbound.query();
          const replies = records.flatMap((r) =>
            r.kind === "message" && r.text.includes("[fetch ") ? [r.text] : [],
          );
          const replyText = replies.at(-1) ?? "";
          if (
            replies.length >= turnsFired &&
            turnsFired < fetchTurnAttempts &&
            !replyText.includes("[fetch 200]")
          ) {
            turnsFired += 1;
            await api.e2e.slackFireMention.mutate({
              user: strangerSlackUserId,
              channel: sharedChannelId,
              ts: "1700000004.000100",
              text: `__FETCH__ ${echoUrl} x-api-key:${placeholder}`,
            });
          }
          return replyText;
        },
        {
          timeout: 180_000,
          intervals: [3_000],
          message: "the fetch the shared turn ran never carried the secret",
        },
      )
      .toContain(sentinel);
  });
});
