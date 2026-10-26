import { expect, test } from "@playwright/test";

import { waitForAgentRunning } from "../../lib/agents.js";
import { createApiClient, type ApiClient } from "../../lib/api-client.js";
import { getAccessToken } from "../../lib/auth.js";
import { agentName } from "../../lib/fixtures.js";

const stopChannelId = "C-E2E-STOP";
const strangerSlackUserId = "U-E2E-STOPPER";
const runningTs = "1700000010.000100";
const stoppedTs = "1700000011.000100";
const wokenTs = "1700000012.000100";

// UNIT_BOUNDARY_DESCRIPTION: whether the mention in one thread was answered. The e2e Slack gateway records what the agent posts, and an ephemeral is not a reply, so any message in the thread is the answer.
async function answeredIn(api: ApiClient, ts: string): Promise<boolean> {
  const { records } = await api.e2e.slackReadOutbound.query();
  return records.some((r) => r.kind === "message" && r.threadTs === ts);
}

test("Stop holds the agent against a channel mention, and Wake releases it", async ({
  page,
}) => {
  test.setTimeout(300_000);

  const token = await getAccessToken();
  const api = createApiClient(token);

  const agentId = await waitForAgentRunning(api, agentName);
  const agentRow = () =>
    page
      .getByTestId("agent-row")
      .filter({ has: page.getByRole("heading", { name: agentName }) });
  const agentActions = () =>
    agentRow().getByRole("button", { name: "Agent actions" });

  await test.step("bind a channel and prove a mention is answered", async () => {
    await api.agents.connectSlack.mutate({
      id: agentId,
      slackChannelId: stopChannelId,
    });
    await api.e2e.slackResetOutbound.mutate();
    await api.e2e.slackFireMention.mutate({
      user: strangerSlackUserId,
      channel: stopChannelId,
      ts: runningTs,
      text: "a mention the running agent answers",
    });
    await expect
      .poll(() => answeredIn(api, runningTs), {
        timeout: 180_000,
        intervals: [2_000],
        message: "a mention was not answered by the running agent",
      })
      .toBe(true);
  });

  await test.step("Stop from the agent's actions", async () => {
    await page.goto("/");
    await agentActions().click();
    await page.getByTestId("agent-stop").click();
    await page
      .getByRole("alertdialog")
      .getByRole("button", { name: "Confirm" })
      .click();
    await expect
      .poll(
        async () => (await api.agents.get.query({ id: agentId })).stopRequested,
        {
          timeout: 60_000,
          intervals: [1_000],
          message: "Stop never set the stop request",
        },
      )
      .toBe(true);
  });

  await test.step("the stopped agent hibernates and a mention does not wake it", async () => {
    await expect
      .poll(async () => (await api.agents.get.query({ id: agentId })).state, {
        timeout: 180_000,
        intervals: [2_000],
        message: "the stopped agent never stopped",
      })
      .toBe("hibernated");

    await api.e2e.slackResetOutbound.mutate();
    await api.e2e.slackFireMention.mutate({
      user: strangerSlackUserId,
      channel: stopChannelId,
      ts: stoppedTs,
      text: "a mention a stopped agent must never answer",
    });
    // UNIT_BOUNDARY_DESCRIPTION: proving a turn did not start has no event to wait for, so the claim is that nothing was posted in the mention's thread over a window long enough for the relay to have woken a merely hibernated agent, and that the agent is still stopped at the end of it.
    await page.waitForTimeout(20_000);

    expect(
      await answeredIn(api, stoppedTs),
      "a stopped agent answered a mention",
    ).toBe(false);
    const agent = await api.agents.get.query({ id: agentId });
    expect(agent.stopRequested, "the mention cleared the stop request").toBe(
      true,
    );
    expect(agent.state, "the mention woke the stopped agent").toBe(
      "hibernated",
    );
  });

  await test.step("Wake starts it and a mention is answered again", async () => {
    await page.reload();
    await agentActions().click();
    await page.getByRole("menuitem", { name: /^(Wake|Start)$/ }).click();
    await expect
      .poll(
        async () => (await api.agents.get.query({ id: agentId })).stopRequested,
        {
          timeout: 60_000,
          intervals: [1_000],
          message: "Wake never cleared the stop request",
        },
      )
      .toBe(false);
    await waitForAgentRunning(api, agentName);

    await api.e2e.slackFireMention.mutate({
      user: strangerSlackUserId,
      channel: stopChannelId,
      ts: wokenTs,
      text: "a mention the woken agent answers",
    });
    await expect
      .poll(() => answeredIn(api, wokenTs), {
        timeout: 180_000,
        intervals: [2_000],
        message: "the woken agent never answered a mention",
      })
      .toBe(true);
  });

  await api.agents.disconnectSlack.mutate({
    id: agentId,
    slackChannelId: stopChannelId,
  });
});
