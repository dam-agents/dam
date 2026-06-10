import { expect, test } from "@playwright/test";

import { baseUrl, testUser2 } from "../config.js";
import { waitForAgentRunning } from "../lib/agents.js";
import { createApiClient } from "../lib/api-client.js";
import { getAccessToken } from "../lib/auth.js";
import { agentName } from "../lib/fixtures.js";

const slackChannelId = "C-E2E-TRACER";
const foreignSlackUserId = "U-E2E-FOREIGN";
const mockDefaultReply = "Hello from the mock agent.";

test("foreign user mention forks the agent and the reply lands back in the thread", async ({
  browser,
}) => {
  test.setTimeout(420_000);

  const token = await getAccessToken();
  const api = createApiClient(token);

  const agentId = await waitForAgentRunning(api, agentName);

  await test.step("bind the agent to a slack channel", async () => {
    await api.agents.connectSlack.mutate({ id: agentId, slackChannelId });
  });

  let loginUrl = "";
  await test.step("request a login link as the foreign slack user", async () => {
    await expect
      .poll(
        async () => {
          try {
            const { ack } = await api.e2e.slackFireCommand.mutate({
              text: "login",
              userId: foreignSlackUserId,
              channelId: slackChannelId,
            });
            loginUrl = ack.match(/<([^|>]+)\|/)?.[1] ?? "";
            return loginUrl !== "";
          } catch {
            return false;
          }
        },
        {
          timeout: 30_000,
          message: "slack gateway did not produce a login link",
        },
      )
      .toBe(true);
  });

  await test.step("link the foreign user via Keycloak OAuth and accept terms", async () => {
    const context = await browser.newContext({
      storageState: { cookies: [], origins: [] },
    });
    const page = await context.newPage();

    await page.goto(baseUrl);
    await page.waitForURL(/\/realms\/platform\/protocol\/openid-connect\/auth/);
    await page.locator("#username").fill(testUser2.username);
    await page.locator("#password").fill(testUser2.password);
    await page.getByRole("button", { name: /sign in/i }).click();

    await page.waitForURL(
      (url) =>
        url.origin === baseUrl && !url.pathname.startsWith("/auth/callback"),
    );

    const termsButton = page.getByRole("button", {
      name: /I accept the Terms of Use/,
    });
    const appSidebar = page.getByTestId("app-sidebar");
    await expect(termsButton.or(appSidebar)).toBeVisible();
    if (await termsButton.isVisible()) {
      await termsButton.click();
      await page.waitForURL(`${baseUrl}/`);
    }
    await expect(appSidebar).toBeVisible();

    await page.goto(loginUrl);
    await expect(page.getByText(/account linked/i)).toBeVisible();

    await context.close();
  });

  await test.step("fire a foreign mention and watch the fork run", async () => {
    await api.e2e.slackResetOutbound.mutate();
    await api.e2e.slackFireMention.mutate({
      user: foreignSlackUserId,
      channel: slackChannelId,
      ts: "1700000001.000100",
      text: "hello from the foreign user",
    });

    await expect
      .poll(
        async () => {
          const { records } = await api.e2e.slackReadOutbound.query();
          return records.some(
            (r) => r.kind === "reaction" && r.name === "eyes",
          );
        },
        {
          timeout: 30_000,
          message:
            "foreign mention was not acknowledged with the eyes reaction",
        },
      )
      .toBe(true);

    await expect
      .poll(
        async () => {
          const { records } = await api.e2e.slackReadOutbound.query();
          return records.some(
            (r) => r.kind === "message" && r.text.includes(mockDefaultReply),
          );
        },
        {
          timeout: 300_000,
          intervals: [5_000],
          message: "fork reply did not land back in the slack thread",
        },
      )
      .toBe(true);

    const { records } = await api.e2e.slackReadOutbound.query();
    const failures = records.filter(
      (r) =>
        (r.kind === "ephemeral" && /could not run turn/i.test(r.text)) ||
        (r.kind === "message" && r.text.startsWith("Error:")),
    );
    expect(failures).toEqual([]);
  });
});
