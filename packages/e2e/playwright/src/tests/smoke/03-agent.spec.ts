import { expect, test } from "@playwright/test";

import { baseUrl } from "../../config.js";
import {
  deleteAgentIfPresent,
  waitForAgentIdRunning,
  waitForAgentRunning,
} from "../../lib/agents.js";
import { createApiClient } from "../../lib/api-client.js";
import { getAccessToken } from "../../lib/auth.js";
import { bootTimeoutMs, onLaneBackend } from "../../lib/backend.js";
import { getConnectionId } from "../../lib/connections.js";
import { agentName, connectionName, harnessName } from "../../lib/fixtures.js";

test("one-click create from the Default kit, then the mock agent with the connection attached", async ({
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

  await test.step("create an agent in one click from the Default kit", async () => {
    await page
      .getByTestId("app-sidebar")
      .getByRole("button", { name: "Starter kits" })
      .click();
    await page.getByTestId("default-agent-card").click();
    await expect(page).toHaveURL(/\/chat\//);
  });

  await test.step("the default provider was granted at create", async () => {
    const agent = (await api.agents.list.query()).find((a) =>
      /^agent(-\d+)?$/.test(a.name),
    );
    expect(agent?.avatar).toBeTruthy();
    const openai = (await api.connections.list.query()).find(
      (c) => c.templateId === "openai",
    );
    const { connections } = await api.connections.getAgentConnections.query({
      agentId: agent!.id,
    });
    expect(connections.map((c) => c.connectionId)).toContain(openai!.id);
    await waitForAgentIdRunning(api, agent!.id);
    await deleteAgentIfPresent(api, agent!.name);
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
});
