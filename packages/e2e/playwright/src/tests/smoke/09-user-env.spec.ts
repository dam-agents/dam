import { expect, test } from "@playwright/test";

import { expectAgentEnv, wakeAgent } from "../../lib/agents.js";
import { createApiClient, type ApiClient } from "../../lib/api-client.js";
import { getAccessToken } from "../../lib/auth.js";
import { agentName, envName, placeholder } from "../../lib/fixtures.js";

const userEnvName = "E2E_USER_ENV";
const userEnvValue = "user-value-9d2f";
const userEnvEdited = "user-value-edited-4a7b";
const shadowValue = "user-overrides-connection-1c8e";

test("user env rides the contribution rail", async () => {
  test.setTimeout(420_000);

  const token = await getAccessToken();
  const api = createApiClient(token);

  const agentId = await wakeAgent(api, agentName);

  const baselineEnv = (await api.agents.get.query({ id: agentId })).env ?? [];

  await test.step("setting user env reaches the agent — no pod roll", async () => {
    await api.agents.update.mutate({
      id: agentId,
      env: [...baselineEnv, { name: userEnvName, value: userEnvValue }],
    });
    await expectAgentEnv(
      api,
      agentId,
      userEnvName,
      userEnvValue,
      `user env ${userEnvName} did not reach the agent`,
    );
  });

  await test.step("editor view is fed from the store, not the CR", async () => {
    const agent = await api.agents.get.query({ id: agentId });
    expect(agent.env).toContainEqual({
      name: userEnvName,
      value: userEnvValue,
    });
  });

  await test.step("editing the value applies at the next turn", async () => {
    await api.agents.update.mutate({
      id: agentId,
      env: [...baselineEnv, { name: userEnvName, value: userEnvEdited }],
    });
    await expectAgentEnv(
      api,
      agentId,
      userEnvName,
      userEnvEdited,
      `edited user env did not converge`,
    );
  });

  await test.step("user env wins over connection env on name collision", async () => {
    await api.agents.update.mutate({
      id: agentId,
      env: [
        ...baselineEnv,
        { name: userEnvName, value: userEnvEdited },
        { name: envName, value: shadowValue },
      ],
    });
    await expectAgentEnv(
      api,
      agentId,
      envName,
      shadowValue,
      `user env did not shadow the connection-derived env`,
    );
  });

  await test.step("clearing user env reverts to the connection env", async () => {
    await api.agents.update.mutate({ id: agentId, env: baselineEnv });
    await expectAgentEnv(
      api,
      agentId,
      envName,
      placeholder,
      `connection env did not revert to its placeholder after clearing user env`,
    );
  });
});
