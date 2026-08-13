import { expect, test } from "@playwright/test";

import { ensureAgentExists, waitForAgentRunning } from "../../lib/agents.js";
import { createApiClient } from "../../lib/api-client.js";
import { acceptTerms, getAccessToken } from "../../lib/auth.js";
import { harnessName } from "../../lib/fixtures.js";

const agentName = "e2e-slack-multi";

const channelA = "C-E2E-MULTI-A";
const channelB = "C-E2E-MULTI-B";
const strangerSlackUserId = "U-E2E-STRANGER";
const mockDefaultReply = "Hello from the mock agent.";

const sharedTs = "1700000900.000100";

const textIn = (channel: string) => `hello from ${channel}`;

async function repliedInThread(
  api: ReturnType<typeof createApiClient>,
  channel: string,
) {
  const { records } = await api.e2e.slackReadOutbound.query();
  return records.some(
    (r) =>
      r.kind === "message" &&
      r.channel === channel &&
      r.threadTs === sharedTs &&
      r.text.includes(mockDefaultReply),
  );
}

test("one agent serves two Slack channels, each its own conversation (#3086)", async () => {
  test.setTimeout(360_000);

  const token = await getAccessToken();
  const api = createApiClient(token);
  await acceptTerms(api);
  await ensureAgentExists(api, agentName, harnessName);
  const agentId = await waitForAgentRunning(api, agentName);

  await test.step("both channels bind to the same agent", async () => {
    await api.agents.disconnectSlack.mutate({ id: agentId });
    await api.agents.connectSlack.mutate({
      id: agentId,
      slackChannelId: channelA,
    });
    await api.agents.connectSlack.mutate({
      id: agentId,
      slackChannelId: channelB,
    });

    const agent = await api.agents.get.query({ id: agentId });
    const bound = agent.channels
      .filter((c) => c.type === "slack")
      .map((c) => c.slackChannelId)
      .sort();
    expect(bound).toEqual([channelA, channelB].sort());
  });

  await test.step("a mention in each channel is answered in that channel", async () => {
    await api.e2e.slackResetOutbound.mutate();
    for (const channel of [channelA, channelB]) {
      await api.e2e.slackFireMention.mutate({
        user: strangerSlackUserId,
        channel,
        ts: sharedTs,
        text: textIn(channel),
      });
      await expect
        .poll(() => repliedInThread(api, channel), {
          timeout: 180_000,
          intervals: [5_000],
          message: `no reply landed in ${channel}`,
        })
        .toBe(true);
    }
  });

  await test.step("disconnecting one channel leaves the other bound", async () => {
    await api.agents.disconnectSlack.mutate({
      id: agentId,
      slackChannelId: channelA,
    });
    const agent = await api.agents.get.query({ id: agentId });
    expect(
      agent.channels
        .filter((c) => c.type === "slack")
        .map((c) => c.slackChannelId),
    ).toEqual([channelB]);
  });

  await test.step("the released channel no longer reaches the agent", async () => {
    await api.e2e.slackResetOutbound.mutate();
    await api.e2e.slackFireMention.mutate({
      user: strangerSlackUserId,
      channel: channelA,
      ts: "1700000901.000100",
      text: "anyone home?",
    });
    await expect
      .poll(
        async () => {
          const { records } = await api.e2e.slackReadOutbound.query();
          return records.some(
            (r) => r.kind === "ephemeral" && r.channel === channelA,
          );
        },
        {
          timeout: 60_000,
          intervals: [2_000],
          message: "the unbound channel did not decline the mention",
        },
      )
      .toBe(true);
  });

  await test.step("cleanup: release the remaining binding", async () => {
    await api.agents.disconnectSlack.mutate({ id: agentId });
  });
});
