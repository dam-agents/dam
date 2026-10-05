import { expect, test } from "@playwright/test";

import { openAgentChat, waitForAgentRunning } from "../../lib/agents.js";
import { type ApiClient, createApiClient } from "../../lib/api-client.js";
import { getAccessToken } from "../../lib/auth.js";
import { agentName } from "../../lib/fixtures.js";

const host = "postman-echo.com";
const gatedUrl = `https://${host}/ip`;

async function fetchStatus(
  api: ApiClient,
  agentId: string,
  url: string,
): Promise<number> {
  try {
    return (await api.e2e.performFetch.mutate({ agentId, url })).status;
  } catch {
    return 0;
  }
}

test("a request joining an open network approval prompts in the conversation on screen", async ({
  page,
}) => {
  test.setTimeout(300_000);

  const token = await getAccessToken();
  const api = createApiClient(token);
  const agentId = await waitForAgentRunning(api, agentName);

  const pendingFor = async () =>
    (await api.approvals.listForInstance.query({ agentId })).filter(
      (a) =>
        a.status === "pending" &&
        a.payload.kind === "ext_authz" &&
        a.payload.host === host &&
        a.payload.path === "/ip",
    );

  const first = fetchStatus(api, agentId, gatedUrl);

  await test.step("the first request opens an approval nobody answers", async () => {
    await expect
      .poll(async () => (await pendingFor()).length, {
        timeout: 60_000,
        message: "the first request did not open an approval",
      })
      .toBe(1);
  });

  await test.step("an identical retry from a new conversation shows the prompt there", async () => {
    await openAgentChat(page, agentName, agentId);
    const retry = fetchStatus(api, agentId, gatedUrl);
    const prompt = page
      .getByTestId("chat-egress-approval")
      .filter({ hasText: `GET ${host}/ip` });
    await expect(prompt).toBeVisible({ timeout: 30_000 });
    expect(await pendingFor()).toHaveLength(1);

    await prompt.getByRole("button", { name: "Allow once" }).click();
    await expect(prompt).toBeHidden({ timeout: 30_000 });
    expect(await retry).toBe(200);
    expect(await first).toBe(200);
  });

  await test.step("the answer clears the approval from the Home queue", async () => {
    expect(await pendingFor()).toHaveLength(0);
    await page.goto("/");
    await page.getByTestId("open-activity").click();
    await expect(
      page
        .getByTestId("feed-approval-card")
        .filter({ hasText: `GET ${host}/ip` }),
    ).toHaveCount(0);
  });
});
