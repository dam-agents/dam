import { expect, test } from "@playwright/test";

import { baseUrl } from "../config.js";
import { waitForAgentRunning } from "../lib/agents.js";
import { createApiClient } from "../lib/api-client.js";
import { getAccessToken } from "../lib/auth.js";
import {
  ensureCustomHeaderConnection,
  getConnectionId,
} from "../lib/connections.js";
import {
  agentName,
  connectionHost,
  headerName,
  valueFormat,
} from "../lib/fixtures.js";

const originalName = "e2e-regrant-original";
const recreatedName = "e2e-regrant-recreated";
const regrantEnvName = "E2E_REGRANT_KEY";
const regrantValue = "e2e-regrant-secret-5e1c";

// Regression for #2426: disconnecting a granted connection on the sandbox
// settings page and creating a replacement of the same type left the deleted
// id staged in the form, so Save failed with "connection ... not owned by
// caller".
test("recreating a disconnected connection saves cleanly", async ({ page }) => {
  test.setTimeout(240_000);

  const token = await getAccessToken();
  const api = createApiClient(token);

  let agentId = "";
  let originalId = "";

  await test.step("grant a dedicated connection to the agent", async () => {
    const listed = (await api.agents.list.query()).find(
      (a) => a.name === agentName,
    );
    expect(
      listed,
      `agent ${agentName} must exist from earlier specs`,
    ).toBeTruthy();
    // The grant fanout pushes contributions to the pod, so make sure earlier
    // specs didn't leave the agent hibernating.
    await api.agents.wake.mutate({ id: listed!.id });
    agentId = await waitForAgentRunning(api, agentName);

    for (const c of await api.connections.list.query()) {
      if (c.name === originalName || c.name === recreatedName)
        await api.connections.delete.mutate({ id: c.id });
    }

    originalId = await ensureCustomHeaderConnection(api, {
      name: originalName,
      host: connectionHost,
      headerName,
      valueFormat,
      value: regrantValue,
      envName: regrantEnvName,
    });

    const current = await api.connections.getAgentConnections.query({
      agentId,
    });
    await api.connections.setAgentConnections.mutate({
      agentId,
      connectionIds: [
        ...current.connections.map((c) => c.connectionId),
        originalId,
      ],
    });
  });

  await test.step("open the sandbox settings page", async () => {
    await page.goto(`${baseUrl}/sandboxes/${agentId}`);
    await expect(page.getByRole("heading", { name: agentName })).toBeVisible();
    await expect(
      page.getByTestId(`connection-grant-${originalId}`).getByRole("checkbox"),
    ).toBeChecked();
  });

  await test.step("disconnect the granted connection", async () => {
    await page
      .getByTestId(`connection-grant-${originalId}`)
      .getByRole("button", { name: "Disconnect" })
      .click();
    await page
      .getByRole("alertdialog")
      .getByRole("button", { name: "Disconnect" })
      .click();
    await expect(page.getByTestId(`connection-grant-${originalId}`)) //
      .toBeHidden();
  });

  await test.step("create a replacement of the same type", async () => {
    await page.getByRole("button", { name: /show all/i }).click();
    await page.getByTestId("connection-template-custom-header").click();

    await page.getByTestId("connection-field-name").fill(recreatedName);
    await page.getByTestId("connection-field-host").fill(connectionHost);
    await page.getByTestId("connection-field-headerName").fill(headerName);
    await page.getByTestId("connection-field-valueFormat").fill(valueFormat);
    await page.getByTestId("connection-field-value").fill(regrantValue);
    await page.getByTestId("connection-field-envName").fill(regrantEnvName);
    await page.getByTestId("connection-create-submit").click();
    await expect(page.getByTestId("connection-create-submit")).toBeHidden();
  });

  await test.step("save succeeds and the new grant lands", async () => {
    const recreatedId = await getConnectionId(api, recreatedName);
    await expect(
      page.getByTestId(`connection-grant-${recreatedId}`).getByRole("checkbox"),
    ).toBeChecked();

    await page.getByRole("button", { name: "Save", exact: true }).click();

    await expect
      .poll(
        async () => {
          const grants = await api.connections.getAgentConnections.query({
            agentId,
          });
          return grants.connections.map((c) => c.connectionId);
        },
        {
          timeout: 30_000,
          message: "recreated connection grant did not land",
        },
      )
      .toContain(recreatedId);

    const grants = await api.connections.getAgentConnections.query({
      agentId,
    });
    expect(grants.connections.map((c) => c.connectionId)) //
      .not.toContain(originalId);
    await expect(page.getByText(/not owned by caller/)).toBeHidden();
  });

  await test.step("clean up the replacement connection", async () => {
    await api.connections.delete.mutate({
      id: await getConnectionId(api, recreatedName),
    });
  });
});
