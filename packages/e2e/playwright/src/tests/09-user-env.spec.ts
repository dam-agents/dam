import { expect, test } from "@playwright/test";

import { waitForAgentRunning } from "../lib/agents.js";
import { createApiClient, type ApiClient } from "../lib/api-client.js";
import { getAccessToken } from "../lib/auth.js";
import { agentName, envName, placeholder } from "../lib/fixtures.js";

const userEnvName = "E2E_USER_ENV";
const userEnvValue = "user-value-9d2f";
const userEnvEdited = "user-value-edited-4a7b";
// A user entry colliding with the granted connection's env (envName).
const shadowValue = "user-overrides-connection-1c8e";

/** Poll the agent's live process env until the named var converges to `expected`. */
async function expectAgentEnv(
  api: ApiClient,
  agentId: string,
  name: string,
  expected: string,
  message: string,
): Promise<void> {
  await expect
    .poll(
      async () => {
        try {
          return (await api.e2e.getEnv.query({ agentId, name })).value;
        } catch {
          return undefined;
        }
      },
      { timeout: 120_000, intervals: [2_000], message },
    )
    .toBe(expected);
}

// User env is delivered over the runtime channel, not the controller, so edits apply next turn.
test("user env rides the contribution rail", async () => {
  test.setTimeout(420_000);

  const token = await getAccessToken();
  const api = createApiClient(token);

  // getEnv talks to the pod directly, so wake it in case earlier specs let it idle.
  const listed = (await api.agents.list.query()).find(
    (a) => a.name === agentName,
  );
  expect(
    listed,
    `agent ${agentName} must exist from earlier specs`,
  ).toBeTruthy();
  await api.agents.wake.mutate({ id: listed!.id });
  const agentId = await waitForAgentRunning(api, agentName);

  // agents.update replaces the whole agent_env list, which also carries the
  // template-seeded env (e.g. the mock's MOCK_DEFAULT_REPLY). Keep the
  // baseline in every update and restore it at the end — wiping it strips
  // the default reply from forks and breaks 07-slack.
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
