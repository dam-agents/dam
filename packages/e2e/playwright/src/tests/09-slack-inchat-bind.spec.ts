import { expect, test } from "@playwright/test";

import { waitForAgentRunning } from "../lib/agents.js";
import { createApiClient } from "../lib/api-client.js";
import { getAccessToken } from "../lib/auth.js";
import { agentName } from "../lib/fixtures.js";

// This spec exercises the in-chat bind/unbind slash commands at the command
// level (deterministic, no OAuth round-trip). It replaces the agent's single
// Slack binding, so it runs as its own project after "slack-shared".
const inchatChannelId = "C-E2E-INCHAT";
const freshChannelId = "C-E2E-INCHAT-FRESH";
// A Slack user with no linked platform identity — channel membership only.
const strangerSlackUserId = "U-E2E-INCHAT-STRANGER";

test("in-chat /bind offers a connect link on an unbound channel", async () => {
  test.setTimeout(120_000);
  const token = await getAccessToken();
  const api = createApiClient(token);
  await waitForAgentRunning(api, agentName);

  const { ack } = await api.e2e.slackFireCommand.mutate({
    text: "bind",
    userId: strangerSlackUserId,
    channelId: freshChannelId,
  });
  // Anyone may start a bind; the agent picker (behind the link) is where
  // ownership is enforced.
  expect(ack).toContain("Connect an agent");
});

test("a bind cannot override an existing binding (prior binder must unbind first)", async () => {
  test.setTimeout(120_000);
  const token = await getAccessToken();
  const api = createApiClient(token);
  const agentId = await waitForAgentRunning(api, agentName);

  await test.step("owner binds the channel in shared mode", async () => {
    await api.agents.connectSlack.mutate({
      id: agentId,
      slackChannelId: inchatChannelId,
      mode: "shared",
    });
  });

  await test.step("/bind on the bound channel is refused", async () => {
    const { ack } = await api.e2e.slackFireCommand.mutate({
      text: "bind",
      userId: strangerSlackUserId,
      channelId: inchatChannelId,
    });
    expect(ack).toContain("already connected");
  });

  await test.step("an unlinked user cannot /unbind, and the binding survives", async () => {
    const unbind = await api.e2e.slackFireCommand.mutate({
      text: "unbind",
      userId: strangerSlackUserId,
      channelId: inchatChannelId,
    });
    expect(unbind.ack).toContain("Link your account");

    // Still bound: a second /bind is still refused.
    const rebind = await api.e2e.slackFireCommand.mutate({
      text: "bind",
      userId: strangerSlackUserId,
      channelId: inchatChannelId,
    });
    expect(rebind.ack).toContain("already connected");
  });

  await test.step("owner disconnects via the platform (leaves no residue)", async () => {
    await api.agents.disconnectSlack.mutate({ id: agentId });
  });
});
