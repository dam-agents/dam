import { expect, test } from "@playwright/test";

import { createApiClient, type ApiClient } from "../lib/api-client.js";
import { getAccessToken } from "../lib/auth.js";
import { harnessName } from "../lib/fixtures.js";

// Egress Aliasing (#2930): an Invocation target has no egress identity of its
// own — every request it makes is decided by the driver's live rules. Before
// the fix a target always started on the default trusted preset, so a
// zero-egress driver spawned a WIDER child (silent escalation) and this
// spec's first assertion fails.
//
// postman-echo.com is a public echo service (same external-dependency class
// as 11-egress-path-rules) with no connection — the driver's rules are the
// only thing standing between the target and the internet.
const host = "postman-echo.com";
const url = `https://${host}/status/204`;
const driverName = "e2e-egress-driver";

/** Fetch from inside the agent pod through its gateway; 0 = blocked (the
 *  gateway held or denied, the mock's client-side fetch gave up). */
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

test("invocation egress follows the driver", async () => {
  test.setTimeout(600_000);

  const token = await getAccessToken();
  const api = createApiClient(token);

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
    // The mock agent makes the same harness POST the driver SDK does from a
    // real pod. Long ttl so the liveness sweep can't reap the target mid-test.
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
    // Before Egress Aliasing the target ran on the trusted preset and this
    // returned 204 even though the driver allows nothing.
    expect(await fetchStatus(api, targetId, url)).not.toBe(204);
  });

  await test.step("allowing the host on the driver unlocks the running target", async () => {
    // Host-wide rule: enforced on the SNI-only L4 path too, so no gateway
    // roll is involved — the next request from the target must pass. The
    // rule is written on the DRIVER; the target is never touched.
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
