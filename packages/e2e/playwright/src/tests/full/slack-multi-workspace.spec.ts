import { expect, test } from "@playwright/test";

import { ensureAgentExists, waitForAgentRunning } from "../../lib/agents.js";
import { createApiClient } from "../../lib/api-client.js";
import { acceptTerms, getAccessToken } from "../../lib/auth.js";
import { harnessName } from "../../lib/fixtures.js";

const agentName = "e2e-slack-workspaces";

const secondTeamId = "T-E2E-SECOND";
const channelInSecond = "C-E2E-WS-SECOND";
const channelInOriginal = "C-E2E-WS-ORIGINAL";
const strangerSlackUserId = "U-E2E-WS-STRANGER";
const mockDefaultReply = "Hello from the mock agent.";

const ts = "1700000950.000100";

async function outboundFor(
  api: ReturnType<typeof createApiClient>,
  channel: string,
) {
  const { records } = await api.e2e.slackReadOutbound.query();
  return records.find(
    (r) =>
      r.kind === "message" &&
      r.channel === channel &&
      r.text.includes(mockDefaultReply),
  );
}

test("an agent in a second Slack workspace is answered with that workspace's credential (#3516)", async () => {
  test.setTimeout(360_000);

  const token = await getAccessToken();
  const api = createApiClient(token);
  await acceptTerms(api);
  await ensureAgentExists(api, agentName, harnessName);
  const agentId = await waitForAgentRunning(api, agentName);

  await test.step("a conversation is bound before any second workspace exists", async () => {
    await api.agents.disconnectSlack.mutate({ id: agentId });
    await api.agents.connectSlack.mutate({
      id: agentId,
      slackChannelId: channelInOriginal,
    });
  });

  await test.step("a second workspace completes its install", async () => {
    await api.e2e.slackConnectWorkspace.mutate({
      teamId: secondTeamId,
      teamName: "Second Workspace",
      botToken: "xoxb-e2e-second-workspace",
      channels: [
        { id: channelInSecond, name: "second-home", botIsMember: true },
      ],
    });
  });

  await test.step("binding finds the workspace from the conversation id alone", async () => {
    await api.agents.connectSlack.mutate({
      id: agentId,
      slackChannelId: channelInSecond,
    });

    const agent = await api.agents.get.query({ id: agentId });
    const bound = agent.channels
      .filter((c) => c.type === "slack")
      .map((c) => c.slackChannelId)
      .sort();
    expect(bound).toEqual([channelInOriginal, channelInSecond].sort());
  });

  await test.step("the reply goes out under the second workspace, not the operator's", async () => {
    await api.e2e.slackResetOutbound.mutate();
    await api.e2e.slackFireMention.mutate({
      user: strangerSlackUserId,
      channel: channelInSecond,
      ts,
      text: "hello from the second workspace",
      teamId: secondTeamId,
    });

    await expect
      .poll(() => outboundFor(api, channelInSecond).then(Boolean), {
        timeout: 180_000,
        intervals: [5_000],
        message: `no reply landed in ${channelInSecond}`,
      })
      .toBe(true);

    const record = await outboundFor(api, channelInSecond);
    expect(record).toMatchObject({ teamId: secondTeamId });
  });

  await test.step("the binding made before it still answers under the operator's token", async () => {
    await api.e2e.slackResetOutbound.mutate();
    await api.e2e.slackFireMention.mutate({
      user: strangerSlackUserId,
      channel: channelInOriginal,
      ts,
      text: "hello from the original workspace",
    });

    await expect
      .poll(() => outboundFor(api, channelInOriginal).then(Boolean), {
        timeout: 180_000,
        intervals: [5_000],
        message: `no reply landed in ${channelInOriginal}`,
      })
      .toBe(true);

    const record = await outboundFor(api, channelInOriginal);
    expect(record).toMatchObject({ teamId: "" });
  });
});
