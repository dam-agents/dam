import { expect, test } from "@playwright/test";

import { baseUrl } from "../config.js";
import { waitForAgentRunning } from "../lib/agents.js";
import { createApiClient } from "../lib/api-client.js";
import { getAccessToken } from "../lib/auth.js";
import {
  ensureCustomHeaderConnection,
  getConnectionId,
} from "../lib/connections.js";
import { agentName, valueFormat } from "../lib/fixtures.js";

const originalName = "e2e-regrant-original";
const recreatedName = "e2e-regrant-recreated";
const regrantEnvName = "E2E_REGRANT_KEY";
const regrantValue = "e2e-regrant-secret-5e1c";
const regrantHost = "regrant.example.com";
const regrantHeaderName = "x-regrant-key";

// Regression for #2426: deleting a granted connection and creating a
// replacement of the same type must leave the agent's grants clean — the
// deleted id gone, the replacement granted (grants apply immediately on the
// sandbox connections page; creating from the catalogue auto-grants).
test("recreating a disconnected connection regrants cleanly", async ({
  page,
}) => {
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
      host: regrantHost,
      headerName: regrantHeaderName,
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

  await test.step("open the sandbox connections page", async () => {
    await page.goto(`${baseUrl}/sandboxes/${agentId}/connections`);
    await expect(
      page.getByRole("heading", { level: 1, name: agentName }),
    ).toBeVisible();
    await expect(
      page.getByTestId(`catalog-connection-${originalId}`),
    ).toBeVisible();
  });

  await test.step("delete the granted connection via the catalogue", async () => {
    // Delete lives only in the catalogue modal (and settings) — the sandbox
    // list's row menu offers Remove/Manage instead.
    await page.getByTestId("open-connection-catalog").click();
    await page.getByTestId("catalog-tab-custom-headers").click();
    // The section behind the modal renders the same row testids — scope to
    // the modal's provider card.
    const card = page.getByTestId("catalog-provider-custom-header");
    await card.getByTestId(`catalog-menu-${originalId}`).click();
    await page
      .getByRole("menuitem", { name: "Delete this connection" })
      .click();
    await page
      .getByRole("alertdialog")
      .getByRole("button", { name: "Delete connection" })
      .click();
    await expect(
      card.getByTestId(`catalog-connection-${originalId}`),
    ).toBeHidden();
  });

  await test.step("create a replacement of the same type", async () => {
    await page.getByTestId("catalog-new-custom-header").click();

    await page.getByTestId("connection-field-name").fill(recreatedName);
    await page.getByTestId("connection-field-host").fill(regrantHost);
    await page
      .getByTestId("connection-field-headerName")
      .fill(regrantHeaderName);
    await page.getByTestId("connection-field-valueFormat").fill(valueFormat);
    await page.getByTestId("connection-field-value").fill(regrantValue);
    await page.getByTestId("connection-field-envName").fill(regrantEnvName);
    await page.getByTestId("connection-create-submit").click();
    // A successful create auto-grants and closes the catalogue modal.
    await expect(page.getByTestId("catalog-close")).toBeHidden();
  });

  await test.step("the new grant lands and the old one is gone", async () => {
    const recreatedId = await getConnectionId(api, recreatedName);
    await expect(
      page.getByTestId(`catalog-connection-${recreatedId}`),
    ).toBeVisible();

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
