import { expect, test } from "@playwright/test";

import {
  chatInput,
  ensureAgentRunning,
  openAgentChat,
  sendMessageToAgent,
} from "../../lib/agents.js";
import { createApiClient } from "../../lib/api-client.js";
import { acceptTerms, getAccessToken, loginViaUi } from "../../lib/auth.js";

const webAgent = "e2e-ask-question";
const slackAgent = "e2e-ask-question-slack";
const channel = "C-E2E-ASK-QUESTION";
const askedTs = "1700000960.000100";

test("the agent's question is answered in the web chat, across a reload (#4856)", async ({
  page,
}) => {
  test.setTimeout(360_000);

  const api = createApiClient(await getAccessToken());
  await acceptTerms(api);
  const agentId = await ensureAgentRunning(api, webAgent);
  await loginViaUi(page);
  await openAgentChat(page, webAgent, agentId);

  const prompt = page.getByTestId("elicitation-prompt");

  await test.step("the question shows its options, their descriptions and an Other box", async () => {
    await sendMessageToAgent(page, "__ELICIT__");
    await expect(prompt).toBeVisible({ timeout: 60_000 });
    await expect(
      prompt.getByText("Which cache should the agent set up?"),
    ).toBeVisible();
    await expect(prompt.getByTestId("elicitation-option")).toHaveCount(2);
    await expect(
      prompt.getByText("Reuse the database already running"),
    ).toBeVisible();
    await expect(prompt.getByTestId("elicitation-other")).toBeVisible();
    await expect(chatInput(page)).toBeHidden();
  });

  await test.step("a reload shows the open question again", async () => {
    await page.reload();
    const sessionRow = page.getByTestId("session-row").first();
    await expect(sessionRow).toBeVisible({ timeout: 60_000 });
    await sessionRow.click();
    await expect(prompt).toBeVisible({ timeout: 60_000 });
  });

  await test.step("the pick and the typed note reach the agent", async () => {
    await prompt.getByRole("radio", { name: "Postgres" }).click();
    await prompt.getByTestId("elicitation-other").fill("use a new schema");
    await prompt.getByRole("button", { name: "Send answer" }).click();
    await expect(prompt).toBeHidden();
    await expect(
      page.getByText(
        'answer {"action":"accept","content":{"question_0":"Postgres","question_0_custom":"use a new schema"}}',
      ),
    ).toBeVisible({ timeout: 60_000 });
    await expect(chatInput(page)).toBeVisible();
  });
});

test("a Slack turn is never held by the agent's question (#4856)", async () => {
  test.setTimeout(360_000);

  const api = createApiClient(await getAccessToken());
  await acceptTerms(api);
  const agentId = await ensureAgentRunning(api, slackAgent);
  await api.agents.disconnectSlack.mutate({ id: agentId });
  await api.agents.connectSlack.mutate({
    id: agentId,
    slackChannelId: channel,
  });

  await api.e2e.slackResetOutbound.mutate();
  await api.e2e.slackFireMention.mutate({
    user: "U-E2E-ASKER",
    channel,
    ts: askedTs,
    text: "__ELICIT__",
  });

  let replyText = "";
  await expect
    .poll(
      async () => {
        const { records } = await api.e2e.slackReadOutbound.query();
        const reply = records.find(
          (r) =>
            r.kind === "message" &&
            r.channel === channel &&
            r.threadTs === askedTs &&
            r.text.includes("answer "),
        );
        replyText = reply && reply.kind === "message" ? reply.text : "";
        return replyText !== "";
      },
      {
        timeout: 180_000,
        intervals: [5_000],
        message: "the question's outcome never posted back to the thread",
      },
    )
    .toBe(true);
  expect(replyText).toContain('"action":"decline"');
});
