// TEST_OVERVIEW: the shared state the integration suite's specs run on, made by setup and not by a spec, so any spec can be deleted without breaking the ones after it: the stored login of the shared account, its Terms accepted and its assistant switched off, the custom-header connection and the model provider the suite's mock agent holds, and that agent, running.
import { expect, test as setup } from "@playwright/test";

import { baseUrl } from "../../config.js";
import { expectAgentEnv, waitForAgentRunning } from "../../lib/agents.js";
import { type ApiClient, createApiClient } from "../../lib/api-client.js";
import { getAccessToken, submitKeycloakLoginForm } from "../../lib/auth.js";
import { ensureCustomHeaderConnection } from "../../lib/connections.js";
import {
  agentName,
  connectionHost,
  connectionName,
  envName,
  harnessName,
  headerName,
  mockDefaultReply,
  sentinel,
  valueFormat,
} from "../../lib/fixtures.js";

const storageStatePath = "./.auth/user.json";

async function leaveNoAssistant(api: ApiClient): Promise<void> {
  const deadline = Date.now() + 60_000;
  let state = await api.assistants.state.query();
  while ((state === null || !state.ready) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    state = await api.assistants.state.query();
  }
  if (state === null) return;
  const agentId = state.agentId;
  await api.agents.delete.mutate({ id: agentId });
  await expect
    .poll(
      async () =>
        (await api.agents.list.query()).some((agent) => agent.id === agentId),
      { timeout: 120_000, intervals: [2_000] },
    )
    .toBe(false);
}

// TEST_SCENARIO: the shared account signs in through Keycloak and accepts the Terms in the browser, and its session is stored for every spec that drives the web UI as it.
setup("sign the shared account in and store its session", async ({ page }) => {
  await page.goto(baseUrl);
  await page.waitForURL(/\/realms\/platform\/protocol\/openid-connect\/auth/);
  await submitKeycloakLoginForm(page);
  const termsButton = page.getByRole("button", {
    name: /I accept the Terms of Use/,
  });
  const appSidebar = page.getByTestId("app-sidebar");
  await expect(termsButton.or(appSidebar)).toBeVisible();
  if (await termsButton.isVisible()) {
    await termsButton.click();
    await page.waitForURL(`${baseUrl}/`);
  }
  await expect(appSidebar).toBeVisible();
  await page.context().storageState({ path: storageStatePath });
});

// TEST_SCENARIO: the shared account stores the assistant off, as the specs that do not test the assistant expect, and holds none: a create runs behind the request that asked for one, so the wait lets it settle and the Agent it made is then deleted.
setup("switch the shared account's assistant off", async () => {
  setup.setTimeout(240_000);
  const api = createApiClient(await getAccessToken());
  const terms = await api.terms.current.query();
  await api.terms.accept.mutate({ version: terms.version });
  await api.features.setFlag.mutate({ feature: "dambledore", enabled: false });
  await leaveNoAssistant(api);
});

// TEST_SCENARIO: the shared account holds the custom-header connection the injection and egress specs read, a model provider, and the suite's mock agent with that connection, running and reading its default reply.
setup("make the suite's connection, provider and mock agent", async () => {
  setup.setTimeout(300_000);
  const api = createApiClient(await getAccessToken());
  const connectionId = await ensureCustomHeaderConnection(api, {
    name: connectionName,
    host: connectionHost,
    headerName,
    valueFormat,
    value: sentinel,
    envName,
  });
  if (
    !(await api.connections.list.query()).some((c) => c.templateId === "openai")
  )
    await api.connections.create.mutate({
      templateId: "openai",
      name: "openai",
      authKind: "header",
      value: "sk-e2e-dummy-key",
    });
  if (!(await api.agents.list.query()).some((a) => a.name === agentName))
    await api.agents.create.mutate({
      name: agentName,
      templateId: harnessName,
      connectionIds: [connectionId],
    });
  const agentId = await waitForAgentRunning(api, agentName);
  await expectAgentEnv(
    api,
    agentId,
    "MOCK_DEFAULT_REPLY",
    mockDefaultReply,
    "the mock agent's harness never ran with its env",
  );
});
