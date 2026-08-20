import { expect, test } from "@playwright/test";

import { waitForAgentRunning } from "../../lib/agents.js";
import { createApiClient } from "../../lib/api-client.js";
import { getAccessToken } from "../../lib/auth.js";
import { agentName } from "../../lib/fixtures.js";

const inchatChannelId = "C-E2E-INCHAT";
const freshChannelId = "C-E2E-INCHAT-FRESH";
const strangerSlackUserId = "U-E2E-INCHAT-STRANGER";

test("in-chat bind/unbind slash-command behavior", async () => {
  test.setTimeout(180_000);
  const token = await getAccessToken();
  const api = createApiClient(token);
  const agentId = await waitForAgentRunning(api, agentName);

  await test.step("owner binds a channel (starts the gateway)", async () => {
    await api.agents.connectSlack.mutate({
      id: agentId,
      slackChannelId: inchatChannelId,
    });
  });

  await test.step("/bind on an unbound channel offers a connect link", async () => {
    const { ack } = await api.e2e.slackFireCommand.mutate({
      text: "bind",
      userId: strangerSlackUserId,
      channelId: freshChannelId,
    });
    expect(ack).toContain("Connect an agent");
  });

  await test.step("/bind on the connected channel offers to add another agent", async () => {
    const { ack } = await api.e2e.slackFireCommand.mutate({
      text: "bind",
      userId: strangerSlackUserId,
      channelId: inchatChannelId,
    });
    expect(ack).toContain("Connect an agent");
    expect(ack).toContain("Already connected here");
  });

  await test.step("an unlinked user cannot /unbind, and the binding survives", async () => {
    const unbind = await api.e2e.slackFireCommand.mutate({
      text: "unbind",
      userId: strangerSlackUserId,
      channelId: inchatChannelId,
    });
    expect(unbind.ack).toContain("Link your account");

    const rebind = await api.e2e.slackFireCommand.mutate({
      text: "bind",
      userId: strangerSlackUserId,
      channelId: inchatChannelId,
    });
    expect(rebind.ack).toContain("Already connected here");
  });

  await test.step("owner disconnects via the platform (leaves no residue)", async () => {
    await api.agents.disconnectSlack.mutate({ id: agentId });
  });
});
