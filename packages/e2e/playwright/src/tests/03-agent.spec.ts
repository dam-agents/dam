import { expect, test } from "@playwright/test";

import { baseUrl } from "../config.js";
import { waitForAgentRunning } from "../lib/agents.js";
import { createApiClient } from "../lib/api-client.js";
import { getAccessToken } from "../lib/auth.js";
import { getConnectionId } from "../lib/connections.js";
import { agentName, connectionName, harnessName } from "../lib/fixtures.js";

test("create a mock agent with the connection attached", async ({ page }) => {
  test.setTimeout(60_000);

  const token = await getAccessToken();
  const api = createApiClient(token);

  await test.step("assert clean slate", async () => {
    const agent = (await api.agents.list.query()).find(
      (a) => a.name === agentName,
    );
    expect(agent, `agent ${agentName} already exists`).toBeUndefined();

    const providerTypes = new Set([
      "anthropic",
      "ibm-litellm",
      "openai",
      "bob",
    ]);
    const secrets = await api.secrets.list.query();
    for (const secret of secrets) {
      if (providerTypes.has(secret.type))
        await api.secrets.delete.mutate({ id: secret.id });
    }
  });

  await test.step("open app", async () => {
    // Suppress first-run auto-routing — a blank account (providers cleared
    // above) would otherwise skip the list and land in the wizard, breaking
    // the "Create sandbox" flow below.
    await page.addInitScript(() =>
      sessionStorage.setItem("platform-first-run-routed", "1"),
    );
    await page.goto(baseUrl);
    await expect(page.getByTestId("app-sidebar")).toBeVisible();
  });

  await test.step("pick the mock image", async () => {
    await page.getByRole("button", { name: /create sandbox/i }).click();
    await page.getByText(harnessName, { exact: true }).click();
    // The image step now only selects on click; advance with its Continue button.
    await page.getByRole("button", { name: /continue/i }).click();
  });

  await test.step("name the sandbox and connect a provider", async () => {
    await page.getByPlaceholder("my-sandbox").fill(agentName);

    const dialog = page.getByRole("dialog");
    await page.getByRole("button", { name: /openai/i }).click();
    await dialog.locator('input[type="password"]').fill("sk-e2e-dummy-key");
    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(dialog).toBeHidden();

    await page.getByRole("button", { name: /continue/i }).click();
  });

  await test.step("grant the connection and create", async () => {
    const connectionId = await getConnectionId(api, connectionName);

    const checkbox = page
      .getByTestId(`connection-grant-${connectionId}`)
      .getByRole("checkbox");
    await checkbox.click();
    await expect(checkbox).toBeChecked();

    await page.getByRole("button", { name: /create sandbox/i }).click();
  });

  await test.step("agent reaches running", async () => {
    await waitForAgentRunning(api, agentName);
  });
});
