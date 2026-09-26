import { expect, test } from "@playwright/test";

import { expectAgentEnv, waitForAgentRunning } from "../../lib/agents.js";
import { createApiClient } from "../../lib/api-client.js";
import { getAccessToken } from "../../lib/auth.js";
import {
  agentName,
  echoUrl,
  envName,
  placeholder,
  sentinel,
} from "../../lib/fixtures.js";

test("connection injects the credential (env placeholder + egress after Envoy)", async () => {
  test.setTimeout(420_000);

  const token = await getAccessToken();
  const api = createApiClient(token);
  const agentId = await waitForAgentRunning(api, agentName);

  await test.step("env rail: agent sees only the placeholder", async () => {
    await expectAgentEnv(
      api,
      agentId,
      envName,
      placeholder,
      `env ${envName} did not converge to the placeholder`,
    );
  });

  await test.step("egress rail: real value injected after Envoy", async () => {
    await expect
      .poll(
        async () => {
          try {
            const { body } = await api.e2e.performFetch.mutate({
              agentId,
              url: echoUrl,
              headers: { "x-api-key": placeholder },
            });
            return body;
          } catch {
            return "";
          }
        },
        {
          timeout: 120_000,
          intervals: [3_000],
          message:
            "echo endpoint did not return the injected credential after Envoy",
        },
      )
      .toContain(sentinel);
  });
});
