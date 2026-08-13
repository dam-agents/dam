import { expect, test } from "@playwright/test";

import { createApiClient, type ApiClient } from "../../lib/api-client.js";
import { acceptTerms, getAccessToken } from "../../lib/auth.js";
import { harnessName } from "../../lib/fixtures.js";

const host = "postman-echo.com";
const url = `https://${host}/status/204`;
const driverName = "e2e-egress-driver";

async function fetchStatus(
  api: ApiClient,
  agentId: string,
  target: string,
): Promise<number> {
  try {
    const { status } = await api.e2e.performFetch.mutate({
      agentId,
      url: target,
    });
    return status;
  } catch {
    return 0;
  }
}

async function waitRunning(api: ApiClient, agentId: string): Promise<void> {
  await expect
    .poll(async () => (await api.agents.get.query({ id: agentId })).state, {
      timeout: 180_000,
      intervals: [2_000],
      message: `agent ${agentId} did not reach running state`,
    })
    .toBe("running");
}

test("invocation egress follows the driver (#2930)", async () => {
  test.setTimeout(600_000);

  const token = await getAccessToken();
  const api = createApiClient(token);
  await acceptTerms(api);

  let driverId = "";
  await test.step("create a zero-egress driver", async () => {
    const created = await api.agents.create.mutate({
      name: driverName,
      templateId: harnessName,
      egressPreset: "none",
    });
    driverId = created.id;
    await waitRunning(api, driverId);
  });

  let targetId = "";
  await test.step("spawn an invocation target from the driver", async () => {
    const { id } = await api.e2e.spawnInvocation.mutate({
      agentId: driverId,
      templateId: harnessName,
      prompt: "e2e invocation target; stay idle",
      schema: { type: "object" },
      ttlMs: 30 * 60_000,
    });
    targetId = id;
    await waitRunning(api, targetId);
  });

  await test.step("the target inherits the driver's zero egress", async () => {
    expect(await fetchStatus(api, targetId, url)).not.toBe(204);
  });

  await test.step("allowing the host on the driver unlocks the running target", async () => {
    await api.egressRules.create.mutate({
      agentId: driverId,
      host,
      method: "*",
      pathPattern: "*",
      verdict: "allow",
    });
    await expect
      .poll(() => fetchStatus(api, targetId, url), {
        timeout: 120_000,
        intervals: [3_000],
        message: "driver-side allow did not apply to the running target",
      })
      .toBe(204);
  });

  await test.step("the target holds no rule of its own for the host", async () => {
    const rules = await api.egressRules.listForAgent.query({
      agentId: targetId,
    });
    expect(rules.filter((r) => r.host === host)).toEqual([]);
  });

  await test.step("deleting the driver cascades to the target", async () => {
    await api.agents.delete.mutate({ id: driverId });
    await expect
      .poll(
        async () => {
          const list = await api.agents.list.query();
          return list.some((a) => a.id === targetId || a.id === driverId);
        },
        {
          timeout: 60_000,
          intervals: [2_000],
          message: "driver delete did not reap the invocation target",
        },
      )
      .toBe(false);
  });
});
