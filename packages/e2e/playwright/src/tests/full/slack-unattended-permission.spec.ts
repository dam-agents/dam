import { expect, test } from "@playwright/test";

import { ensureAgentExists, waitForAgentRunning } from "../../lib/agents.js";
import { createApiClient } from "../../lib/api-client.js";
import { acceptTerms, getAccessToken } from "../../lib/auth.js";
import { harnessName } from "../../lib/fixtures.js";

const agentName = "e2e-slack-permission";
const channel = "C-E2E-PERMISSION";
const strangerSlackUserId = "U-E2E-STRANGER";
const askedTs = "1700000950.000100";

test("a harness permission prompt on a Slack turn is refused, not auto-approved (#3846)", async () => {
  test.setTimeout(360_000);

  const token = await getAccessToken();
  const api = createApiClient(token);
  await acceptTerms(api);
  await ensureAgentExists(api, agentName, harnessName);
  const agentId = await waitForAgentRunning(api, agentName);

  await test.step("the channel binds to the agent", async () => {
    await api.agents.disconnectSlack.mutate({ id: agentId });
    await api.agents.connectSlack.mutate({
      id: agentId,
      slackChannelId: channel,
    });
  });

  await test.step("the agent asks before a tool call and is told no", async () => {
    await api.e2e.slackResetOutbound.mutate();
    await api.e2e.slackFireMention.mutate({
      user: strangerSlackUserId,
      channel,
      ts: askedTs,
      text: "__ASK__ write_notion_page",
    });

    let replyText = "";
    await expect
      .poll(
        async () => {
          const { records } = await api.e2e.slackReadOutbound.query();
          const reply = records.find(
            (r) =>
              r.kind === "message" &&
              r.channel === channel &&
              r.threadTs === askedTs &&
              r.text.includes("permission "),
          );
          replyText = reply && reply.kind === "message" ? reply.text : "";
          return replyText !== "";
        },
        {
          timeout: 180_000,
          intervals: [5_000],
          message: "the permission outcome never posted back to the thread",
        },
      )
      .toBe(true);

    expect(replyText).toContain("reject-once");
    expect(replyText).not.toContain("allow-once");
    expect(replyText).not.toContain("unanswered");
  });
});
