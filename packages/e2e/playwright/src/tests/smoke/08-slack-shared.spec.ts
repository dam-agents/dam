import { expect, test } from "@playwright/test";

import { waitForAgentRunning } from "../../lib/agents.js";
import { createApiClient } from "../../lib/api-client.js";
import { getAccessToken } from "../../lib/auth.js";
import { agentName, echoUrl, sentinel } from "../../lib/fixtures.js";

const sharedChannelId = "C-E2E-SHARED";
const strangerSlackUserId = "U-E2E-STRANGER";
const mockDefaultReply = "Hello from the mock agent.";
const helloText = "hello from a channel member";

test("any channel member drives the agent through a shared binding", async () => {
  test.setTimeout(240_000);

  const token = await getAccessToken();
  const api = createApiClient(token);

  const agentId = await waitForAgentRunning(api, agentName);

  await test.step("owner binds the channel", async () => {
    await api.agents.connectSlack.mutate({
      id: agentId,
      slackChannelId: sharedChannelId,
    });
  });

  await test.step("a stranger's mention relays via the main pod", async () => {
    await api.e2e.slackResetOutbound.mutate();
    await api.e2e.slackFireMention.mutate({
      user: strangerSlackUserId,
      channel: sharedChannelId,
      ts: "1700000003.000100",
      text: helloText,
    });

    await expect
      .poll(
        async () => {
          const { records } = await api.e2e.slackReadOutbound.query();
          return records.some(
            (r) =>
              r.kind === "message" &&
              r.text.includes(mockDefaultReply) &&
              r.threadTs === "1700000003.000100",
          );
        },
        {
          timeout: 180_000,
          intervals: [5_000],
          message: "the reply did not land back in the slack thread",
        },
      )
      .toBe(true);

    const { records } = await api.e2e.slackReadOutbound.query();
    const denials = records.filter(
      (r) =>
        (r.kind === "ephemeral" &&
          /link your account|don't have access|could not run turn/i.test(
            r.text,
          )) ||
        (r.kind === "message" && r.text.startsWith("Error:")),
    );
    expect(denials).toEqual([]);
  });

  await test.step("the prompt reaching the agent is speaker-labelled", async () => {
    const { prompts } = await api.e2e.getReceivedPrompts.query({ agentId });
    expect(JSON.stringify(prompts)).toContain(
      `<@${strangerSlackUserId}>: ${helloText}`,
    );
  });
});

test("shared turns run under the OWNER's credentials whoever asked", async () => {
  test.setTimeout(240_000);

  const token = await getAccessToken();
  const api = createApiClient(token);
  await waitForAgentRunning(api, agentName);

  await test.step("a stranger's fetch turn carries the owner's credential", async () => {
    await api.e2e.slackResetOutbound.mutate();
    await api.e2e.slackFireMention.mutate({
      user: strangerSlackUserId,
      channel: sharedChannelId,
      ts: "1700000004.000100",
      text: `__FETCH__ ${echoUrl}`,
    });

    let replyText = "";
    await expect
      .poll(
        async () => {
          const { records } = await api.e2e.slackReadOutbound.query();
          const reply = records.find(
            (r) => r.kind === "message" && r.text.includes("[fetch "),
          );
          replyText = reply && reply.kind === "message" ? reply.text : "";
          return replyText !== "";
        },
        {
          timeout: 180_000,
          intervals: [5_000],
          message: "the fetch result did not post back to the thread",
        },
      )
      .toBe(true);

    expect(replyText).toContain(sentinel);
  });
});
