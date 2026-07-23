import { expect, test } from "@playwright/test";

import { waitForAgentRunning } from "../lib/agents.js";
import { createApiClient } from "../lib/api-client.js";
import { getAccessToken } from "../lib/auth.js";
import { agentName } from "../lib/fixtures.js";

// 09 leaves the channel unbound; this spec establishes its own binding
// (rebinding would replace the agent's single Slack binding either way).
const ambientChannelId = "C-E2E-AMBIENT";
// Never logs in and never mentions the bot — ambient mode is what lets the
// agent see this user's messages at all.
const strangerSlackUserId = "U-E2E-STRANGER";
const mockDefaultReply = "Hello from the mock agent.";
const questionText = "does anyone know what the deploy script does?";

test("an unmentioned channel message gets an ambient reply", async () => {
  test.setTimeout(240_000);

  const token = await getAccessToken();
  const api = createApiClient(token);

  const agentId = await waitForAgentRunning(api, agentName);

  await test.step("owner binds the channel shared with ambient on", async () => {
    await api.e2e.slackResetOutbound.mutate();
    await api.agents.disconnectSlack.mutate({ id: agentId });
    await api.agents.connectSlack.mutate({
      id: agentId,
      slackChannelId: ambientChannelId,
      mode: "shared",
      ambient: true,
    });
  });

  await test.step("connecting with ambient posts no announcement to the channel", async () => {
    // Ambient state is never announced channel-visibly — not on connect, not on
    // a toggle. Give any stray post time to surface, then require silence.
    await new Promise((r) => setTimeout(r, 10_000));
    const { records } = await api.e2e.slackReadOutbound.query();
    expect(
      records.filter((r) => r.kind === "message" && r.text.includes("ambient")),
    ).toEqual([]);
  });

  await test.step("a plain message is answered in its own thread", async () => {
    await api.e2e.slackResetOutbound.mutate();
    await api.e2e.slackFireMessage.mutate({
      user: strangerSlackUserId,
      channel: ambientChannelId,
      ts: "1700000005.000100",
      text: questionText,
    });

    await expect
      .poll(
        async () => {
          const { records } = await api.e2e.slackReadOutbound.query();
          return records.some(
            (r) =>
              r.kind === "message" &&
              r.text.includes(mockDefaultReply) &&
              r.threadTs === "1700000005.000100",
          );
        },
        {
          timeout: 180_000,
          intervals: [5_000],
          message: "the ambient reply did not land under the message",
        },
      )
      .toBe(true);

    // Ambient stays out of the way: the platform posts no reaction or ephemeral
    // on the agent's behalf (the agent reaches the channel only via its tools).
    const { records } = await api.e2e.slackReadOutbound.query();
    expect(records.filter((r) => r.kind === "reaction")).toEqual([]);
    expect(records.filter((r) => r.kind === "ephemeral")).toEqual([]);
  });

  await test.step("the prompt is ambient-framed and speaker-labelled", async () => {
    const { prompts } = await api.e2e.getReceivedPrompts.query({ agentId });
    const serialized = JSON.stringify(prompts);
    // The read-along frame plus the explicit-reply tool contract.
    expect(serialized).toContain("<reading-along>");
    expect(serialized).toContain("<how-to-respond>");
    // Brand-independent phrase: the frame announces the install's bot
    // identity so name-addressed messages are answered like mentions.
    expect(serialized).toContain("answer it as you would a mention");
    expect(serialized).toContain(`<@${strangerSlackUserId}>: ${questionText}`);
  });
});

test("without ambient, an unmentioned message stays unanswered", async () => {
  test.setTimeout(240_000);

  const token = await getAccessToken();
  const api = createApiClient(token);
  const agentId = await waitForAgentRunning(api, agentName);

  await test.step("owner dials the binding back to mentions-only", async () => {
    await api.agents.connectSlack.mutate({
      id: agentId,
      slackChannelId: ambientChannelId,
      mode: "shared",
    });
  });

  await test.step("a plain message triggers no relay", async () => {
    await api.e2e.slackResetOutbound.mutate();
    await api.e2e.slackFireMessage.mutate({
      user: strangerSlackUserId,
      channel: ambientChannelId,
      ts: "1700000006.000100",
      text: "chatting amongst ourselves",
    });

    // Proving silence: give a would-be relay ample time to surface, then
    // require that nothing was posted at all.
    await new Promise((r) => setTimeout(r, 15_000));
    const { records } = await api.e2e.slackReadOutbound.query();
    expect(records).toEqual([]);
  });
});
