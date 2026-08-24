import { expect, test } from "@playwright/test";

import { waitForAgentRunning } from "../../lib/agents.js";
import { createApiClient } from "../../lib/api-client.js";
import { getAccessToken } from "../../lib/auth.js";
import { agentName } from "../../lib/fixtures.js";

const host = "postman-echo.com";
const allowedUrl = `https://${host}/status/204`;
const uncoveredUrl = `https://${host}/get`;
const stillGatedUrl = `https://${host}/headers`;

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
      .poll(
        async () => {
          try {
            const { status } = await api.e2e.performFetch.mutate({
              agentId,
              url: allowedUrl,
            });
            return status;
          } catch {
            return 0;
          }
        },
        {
          timeout: 120_000,
          intervals: [3_000],
          message: "allowed path did not go through without approval",
        },
      )
      .toBe(204);
  });

  await test.step("an uncovered path prompts with method+path, not the whole site", async () => {
    void api.e2e.performFetch
      .mutate({ agentId, url: uncoveredUrl })
      .catch(() => {});
    await page.goto("/");
    const card = page
      .getByTestId("feed-approval-card")
      .filter({ hasText: `GET ${host}/get` });
    await expect(card).toBeVisible({ timeout: 30_000 });
    await card.getByRole("button", { name: "More approval actions" }).click();
    await page.getByRole("menuitem", { name: "Allow permanently" }).click();
  });

  await test.step("the approval unlocks exactly the approved path", async () => {
    await expect
      .poll(
        async () => {
          try {
            const { status } = await api.e2e.performFetch.mutate({
              agentId,
              url: uncoveredUrl,
            });
            return status;
          } catch {
            return 0;
          }
        },
        {
          timeout: 60_000,
          intervals: [3_000],
          message: "approved path did not unlock",
        },
      )
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

    const gated = await api.e2e.performFetch
      .mutate({ agentId, url: stillGatedUrl })
      .then(
        (r) => r.status,
        () => 0,
      );
    expect(gated).not.toBe(200);
  });
});
