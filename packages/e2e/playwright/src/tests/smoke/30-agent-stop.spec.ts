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
const runningMention = "a mention the running agent runs";
const stoppedMention = "a mention a stopped agent must never run";
const wokenMention = "a mention the woken agent runs";

// UNIT_BOUNDARY_DESCRIPTION: whether a mention reached the agent's harness. The control call is answered by a running agent's runtime, so it is the record of what the relay delivered, and a hibernated agent cannot answer it at all.
async function receivedPrompt(api: ApiClient, agentId: string, text: string) {
  const { prompts } = await api.e2e.getReceivedPrompts.query({ agentId });
  return JSON.stringify(prompts).includes(text);
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
    await api.e2e.slackFireMention.mutate({
      user: strangerSlackUserId,
      channel: stopChannelId,
      ts: runningTs,
      text: runningMention,
    });
    await expect
      .poll(() => receivedPrompt(api, agentId, runningMention), {
        timeout: 180_000,
        intervals: [2_000],
        message: "a mention never reached the running agent",
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

    await api.e2e.slackFireMention.mutate({
      user: strangerSlackUserId,
      channel: stopChannelId,
      ts: stoppedTs,
      text: stoppedMention,
    });
    // UNIT_BOUNDARY_DESCRIPTION: proving a wake did not happen has no event to wait for, so the claim is that the relay's own attempt left the agent stopped over a window long enough for a wake to have started it.
    await page.waitForTimeout(20_000);

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
      text: wokenMention,
    });
    await expect
      .poll(() => receivedPrompt(api, agentId, wokenMention), {
        timeout: 180_000,
        intervals: [2_000],
        message: "a mention never reached the woken agent",
      })
      .toBe(true);
  });

  await api.agents.disconnectSlack.mutate({
    id: agentId,
    slackChannelId: stopChannelId,
  });
});
