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
  });

  await test.step("open app", async () => {
    await page.goto(baseUrl);
    await expect(page.getByTestId("app-sidebar")).toBeVisible();
  });

  await test.step("create the agent with the connection selected", async () => {
    const connectionId = await getConnectionId(api, connectionName);

    await page.getByRole("button", { name: /create sandbox/i }).click();
    await page.getByText(harnessName, { exact: true }).click();
    await page.getByPlaceholder("my-agent").fill(agentName);

    const checkbox = page
      .getByTestId(`connection-grant-${connectionId}`)
      .getByRole("checkbox");
    await checkbox.click();
    await expect(checkbox).toBeChecked();

    await page.getByRole("button", { name: /create agent/i }).click();
  });

  await test.step("agent reaches running", async () => {
    await waitForAgentRunning(api, agentName);
  });
});
