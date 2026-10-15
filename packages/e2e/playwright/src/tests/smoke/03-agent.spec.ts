import { expect, test } from "@playwright/test";

import { baseUrl } from "../../config.js";
import {
  waitForAgentIdRunning,
  waitForAgentRunning,
} from "../../lib/agents.js";
import { createApiClient } from "../../lib/api-client.js";
import { getAccessToken } from "../../lib/auth.js";
import { bootTimeoutMs, onLaneBackend } from "../../lib/backend.js";
import { getConnectionId } from "../../lib/connections.js";
import { agentName, connectionName, harnessName } from "../../lib/fixtures.js";

test("one-click create from the Generalist kit, then the mock agent with the connection and default provider", async ({
  page,
}) => {
  test.setTimeout(bootTimeoutMs(300_000));

  const token = await getAccessToken();
  const api = createApiClient(token);

  await test.step("assert clean slate", async () => {
    const agent = (await api.agents.list.query()).find(
      (a) => a.name === agentName,
    );
    expect(agent, `agent ${agentName} already exists`).toBeUndefined();

    const providerTemplateIds = new Set([
      "anthropic",
      "anthropic-oauth",
      "ibm-litellm",
      "openai",
      "bob",
    ]);
    const conns = await api.connections.list.query();
    for (const conn of conns) {
      if (providerTemplateIds.has(conn.templateId))
        await api.connections.delete.mutate({ id: conn.id });
    }
  });

  await test.step("open app", async () => {
    await page.goto(baseUrl);
    await expect(page.getByTestId("app-sidebar")).toBeVisible();
  });

  await test.step("connect a provider the new agent is granted", async () => {
    await api.connections.create.mutate({
      templateId: "openai",
      name: "openai",
      authKind: "header",
      value: "sk-e2e-dummy-key",
    });
  });

  await test.step("create an agent in one click from the Generalist kit", async () => {
    await page
      .getByTestId("app-sidebar")
      .getByRole("button", { name: "Starter kits" })
      .click();
    await page.getByTestId("default-agent-card").click();
    await expect(page).toHaveURL(/\/chat\//);
  });

  await test.step("the one-click agent boots with a generated avatar", async () => {
    const agent = (await api.agents.list.query()).find((a) =>
      /^agent(-\d+)?$/.test(a.name),
    );
    expect(agent?.avatar).toBeTruthy();
    await waitForAgentIdRunning(api, agent!.id);
  });

  await test.step("delete the one-click agent from its configuration page", async () => {
    const agent = (await api.agents.list.query()).find((a) =>
      /^agent(-\d+)?$/.test(a.name),
    );
    await page.goto(baseUrl);
    await page
      .getByTestId("agent-row")
      .filter({
        has: page.getByRole("heading", { name: agent!.name, exact: true }),
      })
      .getByRole("button", { name: "Configure agent" })
      .press("Enter");
    await page
      .getByRole("button", { name: "Delete", exact: true })
      .press("Enter");
    await page
      .getByRole("alertdialog")
      .getByRole("button", { name: "Delete agent" })
      .click();
    await expect
      .poll(
        async () =>
          (await api.agents.list.query()).some((a) => a.id === agent!.id),
        { timeout: 120_000, intervals: [2_000] },
      )
      .toBe(false);
  });

  await test.step("create the suite's mock agent with the connection", async () => {
    await api.agents.create.mutate(
      onLaneBackend({
        name: agentName,
        templateId: harnessName,
        connectionIds: [await getConnectionId(api, connectionName)],
      }),
    );
    await waitForAgentRunning(api, agentName);
  });

  await test.step("the default provider was granted at create", async () => {
    const agent = (await api.agents.list.query()).find(
      (a) => a.name === agentName,
    );
    const openai = (await api.connections.list.query()).find(
      (c) => c.templateId === "openai",
    );
    const { connections } = await api.connections.getAgentConnections.query({
      agentId: agent!.id,
    });
    expect(connections.map((c) => c.connectionId)).toContain(openai!.id);
  });
});
