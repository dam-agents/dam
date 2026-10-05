import { expect, test } from "@playwright/test";

import { openAgentChat, waitForAgentRunning } from "../../lib/agents.js";
import { type ApiClient, createApiClient } from "../../lib/api-client.js";
import { getAccessToken } from "../../lib/auth.js";
import { agentName } from "../../lib/fixtures.js";

const host = "postman-echo.com";
const allowedUrl = `https://${host}/status/204`;
const uncoveredUrl = `https://${host}/get`;
const stillGatedUrl = `https://${host}/headers`;
const chatAnsweredPath = "/ip";

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

test("path-scoped HTTPS rules are enforced and approvals stay narrow", async ({
  page,
}) => {
  test.setTimeout(420_000);

  const token = await getAccessToken();
  const api = createApiClient(token);
  const agentId = await waitForAgentRunning(api, agentName);

  await test.step("add a narrow allow rule in the network panel", async () => {
    await page.goto(`/sandboxes/${encodeURIComponent(agentId)}`);
    const net = page.locator("section").filter({ hasText: "Network access" });
    await net.getByLabel("Host").fill(host);
    await net.getByLabel("Method").selectOption("GET");
    await net.getByLabel("Path").fill("/status/*");
    await net.getByLabel("Verdict").selectOption("allow");
    await net.getByRole("button", { name: "Add rule" }).click();
    await page.getByRole("button", { name: "Submit changes" }).click();
    await page.getByRole("button", { name: "Save & restart" }).click();
    await expect
      .poll(
        async () =>
          (await api.egressRules.listForAgent.query({ agentId })).some(
            (r) => r.host === host && r.pathPattern === "/status/*",
          ),
        { timeout: 30_000, message: "panel-created rule did not persist" },
      )
      .toBe(true);
  });

  await test.step("a request matching the rule passes without a prompt", async () => {
    await expect
      .poll(() => fetchStatus(api, agentId, allowedUrl), {
        timeout: 120_000,
        intervals: [3_000],
        message: "allowed path did not go through without approval",
      })
      .toBe(204);
  });

  await test.step("an uncovered path prompts with method+path, not the whole site", async () => {
    void api.e2e.performFetch
      .mutate({ agentId, url: uncoveredUrl })
      .catch(() => {});
    await page.goto("/");
    await page.getByTestId("open-activity").click();
    await page.getByTestId("needs-you-summary").click({ timeout: 30_000 });
    const card = page
      .getByTestId("feed-approval-card")
      .filter({ hasText: `GET ${host}/get` });
    await expect(card).toBeVisible({ timeout: 30_000 });
    await card.getByRole("button", { name: "More approval actions" }).click();
    await page.getByRole("menuitem", { name: "Allow permanently" }).click();
  });

  await test.step("the approval unlocks exactly the approved path", async () => {
    await expect
      .poll(() => fetchStatus(api, agentId, uncoveredUrl), {
        timeout: 60_000,
        intervals: [3_000],
        message: "approved path did not unlock",
      })
      .toBe(200);
  });

  await test.step("no hidden host-wide rule was written", async () => {
    const forHost = (
      await api.egressRules.listForAgent.query({ agentId })
    ).filter((r) => r.host === host);
    expect(
      forHost.map(({ method, pathPattern, verdict }) => ({
        method,
        pathPattern,
        verdict,
      })),
    ).toEqual(
      expect.arrayContaining([
        { method: "GET", pathPattern: "/status/*", verdict: "allow" },
        { method: "GET", pathPattern: "/get", verdict: "allow" },
      ]),
    );
    expect(
      forHost.some((r) => r.method === "*" && r.pathPattern === "*"),
      "approving a narrow prompt must not write a host-wide rule",
    ).toBe(false);

    expect(await fetchStatus(api, agentId, stillGatedUrl)).not.toBe(200);
  });
});

test("a waiting network approval shows in the open conversation, retries included", async ({
  page,
}) => {
  test.setTimeout(300_000);

  const token = await getAccessToken();
  const api = createApiClient(token);
  const agentId = await waitForAgentRunning(api, agentName);
  const url = `https://${host}${chatAnsweredPath}`;

  const waitingFor = async (path: string) =>
    (await api.approvals.listForInstance.query({ agentId })).filter(
      (a) =>
        a.status === "pending" &&
        a.payload.kind === "ext_authz" &&
        a.payload.path === path,
    );

  for (const earlier of await api.approvals.listForInstance.query({
    agentId,
  })) {
    if (earlier.status === "pending")
      await api.approvals.dismiss.mutate({ id: earlier.id });
  }

  const first = fetchStatus(api, agentId, url);
  await expect
    .poll(async () => (await waitingFor(chatAnsweredPath)).length, {
      timeout: 60_000,
      message: "the request was not held for approval",
    })
    .toBe(1);
  const retry = fetchStatus(api, agentId, url);

  await test.step("a conversation opened after the hold shows the prompt", async () => {
    await openAgentChat(page, agentName, agentId);
    const prompt = page
      .getByTestId("chat-egress-approval")
      .filter({ hasText: `GET ${host}${chatAnsweredPath}` });
    await expect(prompt).toBeVisible({ timeout: 30_000 });
    expect(await waitingFor(chatAnsweredPath)).toHaveLength(1);

    await prompt.getByRole("button", { name: "Allow once" }).click();
    await expect(prompt).toBeHidden({ timeout: 30_000 });
  });

  await test.step("answering in the chat releases the waiting requests", async () => {
    expect(await first).toBe(200);
    expect(await retry).toBe(200);
    expect(await waitingFor(chatAnsweredPath)).toHaveLength(0);
  });
});
