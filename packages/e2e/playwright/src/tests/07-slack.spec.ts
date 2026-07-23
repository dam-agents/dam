import { expect, test } from "@playwright/test";

import { baseUrl, testUser2 } from "../config.js";
import { waitForAgentRunning } from "../lib/agents.js";
import { createApiClient } from "../lib/api-client.js";
import { getAccessToken } from "../lib/auth.js";
import { ensureCustomHeaderConnection } from "../lib/connections.js";
import {
  agentName,
  connectionHost,
  echoUrl,
  foreignConnectionName,
  foreignEnvName,
  foreignSentinel,
  headerName,
  valueFormat,
} from "../lib/fixtures.js";

const slackChannelId = "C-E2E-TRACER";
const foreignSlackTeamId = "T-E2E";
const foreignSlackUserId = "U-E2E-FOREIGN";
const mockDefaultReply = "Hello from the mock agent.";

type SlackOutbound = Awaited<
  ReturnType<
    ReturnType<typeof createApiClient>["e2e"]["slackReadOutbound"]["query"]
  >
>["records"];

/** The reply text of a turn, whether it streamed in (start/append/stop) or was
 *  posted as a single message. Streaming is best-effort, so tests accept both. */
function replyText(records: SlackOutbound): string {
  const message = records.find((r) => r.kind === "message");
  if (message && message.kind === "message") return message.text;
  return records
    .map((r) => {
      if (r.kind === "stream_start" || r.kind === "stream_append")
        return r.text;
      if (r.kind === "stream_stop") return r.text ?? "";
      return "";
    })
    .join("");
}

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
      teamId: foreignSlackTeamId,
    });

    // A running status appears while the fork works (live-progress arc). The
    // platform no longer auto-acks with a reaction; the status is the signal.
    await expect
      .poll(
        async () => {
          const { records } = await api.e2e.slackReadOutbound.query();
          return records.some(
            (r) => r.kind === "status" && r.status.length > 0,
          );
        },
        {
          timeout: 60_000,
          intervals: [2_000],
          message: "no working status was shown while the fork ran",
        },
      )
      .toBe(true);

    await expect
      .poll(
        async () => {
          const { records } = await api.e2e.slackReadOutbound.query();
          return replyText(records).includes(mockDefaultReply);
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
    // The status is cleared once the turn is done.
    const statuses = records.filter((r) => r.kind === "status");
    expect(statuses.at(-1)).toMatchObject({ status: "" });
  });
});

test("foreign-user fork injects the foreign user's credential on egress", async () => {
  test.setTimeout(420_000);

  const token = await getAccessToken();
  const api = createApiClient(token);
  await waitForAgentRunning(api, agentName);

  await test.step("foreign user creates their own credential connection", async () => {
    const foreignApi = createApiClient(await getAccessToken(testUser2));
    await ensureCustomHeaderConnection(foreignApi, {
      name: foreignConnectionName,
      host: connectionHost,
      headerName,
      valueFormat,
      value: foreignSentinel,
      envName: foreignEnvName,
    });
  });

  await test.step("foreign mention forks and the fork egress carries the foreign credential", async () => {
    await api.e2e.slackResetOutbound.mutate();
    await api.e2e.slackFireMention.mutate({
      user: foreignSlackUserId,
      channel: slackChannelId,
      ts: "1700000002.000100",
      text: `__FETCH__ ${echoUrl}`,
      teamId: foreignSlackTeamId,
    });

    let reply = "";
    await expect
      .poll(
        async () => {
          const { records } = await api.e2e.slackReadOutbound.query();
          reply = replyText(records);
          return reply.includes("[fetch ");
        },
        {
          timeout: 300_000,
          intervals: [5_000],
          message: "fork did not post the egress result back to the thread",
        },
      )
      .toBe(true);

    expect(reply).toContain(foreignSentinel);
  });
});
