import { expect, test } from "@playwright/test";

import { waitForAgentRunning } from "../../lib/agents.js";
import { createApiClient } from "../../lib/api-client.js";
import { getAccessToken } from "../../lib/auth.js";
import { agentName } from "../../lib/fixtures.js";

const stopChannelId = "C-E2E-STOP";
const strangerSlackUserId = "U-E2E-STOPPER";
const stoppedPrompt = "this mention must never reach a stopped agent";
const startedPrompt = "this mention must reach the agent once it is started";

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

  await test.step("bind a channel and prove a mention reaches the agent", async () => {
    await api.agents.connectSlack.mutate({
      id: agentId,
      slackChannelId: stopChannelId,
    });
    await api.e2e.slackFireMention.mutate({
      user: strangerSlackUserId,
      channel: stopChannelId,
      ts: "1700000010.000100",
      text: stoppedPrompt,
    });
    await expect
      .poll(
        async () =>
          JSON.stringify(
            (await api.e2e.getReceivedPrompts.query({ agentId })).prompts,
          ).includes(stoppedPrompt),
        {
          timeout: 180_000,
          intervals: [2_000],
          message: "a mention did not reach a running agent",
        },
      )
      .toBe(true);
  });

  await test.step("Stop from the agent's actions", async () => {
    await page.goto("/");
    await agentRow().getByRole("button", { name: "Agent actions" }).click();
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
    const before = (await api.e2e.getReceivedPrompts.query({ agentId }))
      .prompts;

    await api.e2e.slackFireMention.mutate({
      user: strangerSlackUserId,
      channel: stopChannelId,
      ts: "1700000011.000100",
      text: startedPrompt,
    });
    // UNIT_BOUNDARY_DESCRIPTION: proving a turn did not start has no event to wait for, so the claim is that no prompt reached the agent over a window long enough for the relay to have woken a merely hibernated agent.
    await page.waitForTimeout(20_000);

    const after = (await api.e2e.getReceivedPrompts.query({ agentId })).prompts;
    expect(after.length, "a mention reached a stopped agent").toBe(
      before.length,
    );
    const agent = await api.agents.get.query({ id: agentId });
    expect(agent.stopRequested, "the mention cleared the stop request").toBe(
      true,
    );
    expect(agent.state, "the mention woke the stopped agent").toBe(
      "hibernated",
    );
  });

  await test.step("Wake starts it and the same mention then reaches it", async () => {
    await page.reload();
    await agentRow().getByRole("button", { name: "Agent actions" }).click();
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
      ts: "1700000012.000100",
      text: startedPrompt,
    });
    await expect
      .poll(
        async () =>
          JSON.stringify(
            (await api.e2e.getReceivedPrompts.query({ agentId })).prompts,
          ).includes(startedPrompt),
        {
          timeout: 180_000,
          intervals: [2_000],
          message: "the started agent never ran the mention",
        },
      )
      .toBe(true);
  });

  await api.agents.disconnectSlack.mutate({
    id: agentId,
    slackChannelId: stopChannelId,
  });
});
