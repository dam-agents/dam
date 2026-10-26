// TEST_OVERVIEW: a person connects an agent from the platform only to a Slack channel they and the bot are both in. The channel choices list exactly those channels, and a connect to any other channel is refused before a binding exists.
import { expect, test } from "@playwright/test";

import { ensureAgentRunning } from "../../lib/agents.js";
import { createApiClient } from "../../lib/api-client.js";
import { acceptTerms, getAccessToken } from "../../lib/auth.js";
import { connectSlackAsMember } from "../../lib/slack.js";

const agentName = "e2e-slack-membership";
const sharedChannel = "C-E2E-MEMBER-SHARED";
const botOnlyChannel = "C-E2E-MEMBER-BOT-ONLY";

test("a Slack channel connects only when the person and the bot are both in it (#3810)", async () => {
  test.setTimeout(240_000);

  const token = await getAccessToken();
  const api = createApiClient(token);
  await acceptTerms(api);
  const agentId = await ensureAgentRunning(api, agentName);

  await test.step("a shared channel is offered and connects", async () => {
    await api.agents.disconnectSlack.mutate({ id: agentId });
    await api.e2e.slackAddMember.mutate({
      slackUserId: "U-E2E-MEMBER-STRANGER",
      channelId: botOnlyChannel,
      linkToCaller: false,
    });
    await connectSlackAsMember(api, {
      id: agentId,
      slackChannelId: sharedChannel,
    });

    const choices = await api.channels.slackChannelChoices.query();
    const offered = choices.linked ? choices.channels.map((c) => c.id) : [];
    expect(offered).toContain(sharedChannel);
    expect(offered).not.toContain(botOnlyChannel);
  });

  await test.step("a channel only the bot is in is refused", async () => {
    await expect(
      api.agents.connectSlack.mutate({
        id: agentId,
        slackChannelId: botOnlyChannel,
      }),
    ).rejects.toThrow(/you and the bot are both in/);
  });

  await test.step("cleanup", async () => {
    await api.agents.disconnectSlack.mutate({ id: agentId });
  });
});
