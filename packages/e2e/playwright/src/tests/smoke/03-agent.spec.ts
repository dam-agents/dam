import { expect, test } from "@playwright/test";

import { baseUrl } from "../../config.js";
import { waitForAgentRunning } from "../../lib/agents.js";
import { createApiClient } from "../../lib/api-client.js";
import { getAccessToken } from "../../lib/auth.js";
import { bootTimeoutMs } from "../../lib/backend.js";
import { getConnectionId } from "../../lib/connections.js";
import { agentName, connectionName, harnessName } from "../../lib/fixtures.js";

test("create a mock agent with the connection attached", async ({ page }) => {
  test.setTimeout(bootTimeoutMs(60_000));

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

  await test.step("open the coding agent setup page", async () => {
    await page.goto(`${baseUrl}/agents/new`);
    await expect(page.getByTestId("provider-select")).toBeVisible();
  });

  await test.step("pick the mock image", async () => {
    await page.getByTestId(`template-card-${harnessName}`).click();
  });

  await test.step("name the sandbox and connect a provider", async () => {
    await page.getByPlaceholder("my-agent").fill(agentName);

    const dialog = page.getByRole("dialog");
    await page.getByTestId("provider-select").click();
    await page.getByTestId("provider-option-openai").click();
    await dialog.locator('input[type="password"]').fill("sk-e2e-dummy-key");
    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(dialog).toBeHidden();
  });

  await test.step("grant the connection and create", async () => {
    const connectionId = await getConnectionId(api, connectionName);

    await page.getByTestId("open-connection-catalog").click();
    await page.getByTestId("catalog-tab-custom-headers").click();
    await page.getByTestId(`catalog-add-${connectionId}`).click();
    await expect(
      page
        .getByTestId(`catalog-connection-${connectionId}`)
        .getByText("In this agent"),
    ).toBeVisible();
    await page.getByTestId("catalog-close").click();
    await expect(
      page.getByTestId(`catalog-connection-${connectionId}`),
    ).toBeVisible();

    await page.getByRole("button", { name: /create agent/i }).click();
  });

  await test.step("agent reaches running", async () => {
    await waitForAgentRunning(api, agentName);
  });
});

// UNIT_BOUNDARY_DESCRIPTION: the retired template ID each harness in the catalogue is offered under, which is what an agent's spec names and what the create form's card carries.
const harnessTemplateId: Record<string, string> = {
  "claude-code": "claude-code",
  codex: "codex",
  pi: "pi-agent",
  bob: "bob",
};

// TEST_SCENARIO: the catalogue the session can pick from is not the template list, so a harness picked on the create form has to reach the Agent's spec as itself and not as the install's default harness. The form offers one card per catalogue entry, under the retired template ID the api-server still resolves, so the card and the spec name the same harness. This lane's install disables the default template, the image every harness runs from, so it offers no catalogue and the case says so instead of passing on nothing.
test("a harness picked on the create form is the agent's harness", async ({
  page,
}) => {
  test.setTimeout(bootTimeoutMs(180_000));

  const api = createApiClient(await getAccessToken());
  const catalogue = await api.templates.harnesses.query();
  const offered = catalogue.harnesses.filter(
    (h) => h.name !== catalogue.default && h.providers?.includes("openai"),
  );
  const picked = offered.find((h) => h.name === "codex") ?? offered[0];
  test.skip(
    !picked,
    "this install offers no non-default harness on openai: it needs harnessTemplates.default enabled",
  );
  const name = `e2e-harness-${picked!.name}`;
  const existing = (await api.agents.list.query()).find((a) => a.name === name);
  if (existing) await api.agents.delete.mutate({ id: existing.id });

  await page.goto(`${baseUrl}/agents/new`);
  await expect(page.getByTestId("provider-select")).toBeVisible();
  await page
    .getByTestId(`template-card-${harnessTemplateId[picked!.name]}`)
    .click();
  await page.getByPlaceholder("my-agent").fill(name);

  await page.getByTestId("provider-select").click();
  await page.getByTestId("provider-option-openai").click();
  // UNIT_BOUNDARY_DESCRIPTION: the suite's first case already connected openai, so the create form either asks for a key or offers that connection, and only the first needs one.
  const dialog = page.getByRole("dialog");
  if (
    await dialog.waitFor({ timeout: 2_000 }).then(
      () => true,
      () => false,
    )
  ) {
    await dialog.locator('input[type="password"]').fill("sk-e2e-dummy-key");
    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(dialog).toBeHidden();
  }

  await page.getByRole("button", { name: /create agent/i }).click();
  const id = await waitForAgentRunning(api, name);
  expect(
    (await api.agents.get.query({ id })).harness,
    `the agent runs the harness its card named, not the install's default`,
  ).toBe(picked!.name);

  await api.agents.delete.mutate({ id });
});
