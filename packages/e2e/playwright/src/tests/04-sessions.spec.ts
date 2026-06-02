import { expect, test } from "@playwright/test";

import { baseUrl } from "../config.js";
import {
  gotoAgentDetail,
  sendMessageToAgent,
  setMockAgentReply,
} from "../lib/agents.js";
import { createApiClient } from "../lib/api-client.js";
import { getAccessToken } from "../lib/auth.js";

const agentName = "e2e-mock";
const scriptedReply = "session-smoke-reply";
const userPrompt = "session-smoke-prompt";

// ADR-055: the agent owns session existence + metadata. The mock pod runs the
// real agent-runtime (mock-agent.js is only the harness), so this drives the
// full round-trip: create a chat session over ACP, see it in session/list
// enriched from `_meta.platform`, then soft-delete it.
test("agent-owned session lifecycle over ACP (ADR-055)", async ({ page }) => {
  const token = await getAccessToken();
  const api = createApiClient(token);

  const agentId = await test.step("locate the mock agent", async () => {
    const agent = (await api.agents.list.query()).find(
      (a) => a.name === agentName,
    );
    expect(
      agent,
      `agent ${agentName} should exist (created by spec 02)`,
    ).toBeDefined();
    return agent!.id;
  });

  await test.step("open a fresh chat session", async () => {
    await page.goto(baseUrl);
    await expect(page.getByTestId("app-sidebar")).toBeVisible();
    await gotoAgentDetail(page, agentName, agentId);
    await page.getByRole("button", { name: /new session/i }).click();
  });

  const sessionId =
    await test.step("send a message; the agent creates + answers the session", async () => {
      await api.e2e.reset.mutate({ agentId });
      await setMockAgentReply(api, agentId, scriptedReply);
      await sendMessageToAgent(page, userPrompt);
      await expect(page.getByText(scriptedReply)).toBeVisible({
        timeout: 30_000,
      });

      let sid = "";
      await expect
        .poll(
          async () => {
            const { prompts } = await api.e2e.getReceivedPrompts.query({
              agentId,
            });
            const match = prompts.find((p) =>
              JSON.stringify(p.prompt ?? "").includes(userPrompt),
            );
            if (match) sid = match.sessionId;
            return Boolean(match);
          },
          { timeout: 15_000, message: "mock never recorded the prompt" },
        )
        .toBe(true);
      return sid;
    });

  await test.step("session/list shows it enriched as a chat session", async () => {
    await page.getByTestId("sessions-refresh").click();
    const row = page.getByTestId(`session-row-${sessionId}`);
    await expect(row).toBeVisible({ timeout: 15_000 });
    // A session created over ACP carries `_meta.platform.mode=chat`; if the
    // round-trip failed it would decode as terminal (badge). Assert no badge.
    await expect(row.getByText("terminal", { exact: true })).toHaveCount(0);
  });

  await test.step("platform/deleteSession tombstones it", async () => {
    const row = page.getByTestId(`session-row-${sessionId}`);
    await row.hover();
    await row.getByRole("button", { name: /delete session/i }).click();
    await page.getByRole("button", { name: "Confirm" }).click();
    await page.getByTestId("sessions-refresh").click();
    await expect(row).toHaveCount(0, { timeout: 15_000 });
  });
});
