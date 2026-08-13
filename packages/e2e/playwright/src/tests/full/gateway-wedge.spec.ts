import { expect, test } from "@playwright/test";

import { type ApiClient, createApiClient } from "../../lib/api-client.js";
import { acceptTerms, getAccessToken } from "../../lib/auth.js";
import {
  AGENT_NS,
  agentConditionStatus,
  deleteAgentCr,
  kubectl,
  podEvents,
  podField,
  podIsReady,
  scaleController,
  statefulSetField,
} from "../../lib/cluster.js";
import { harnessName } from "../../lib/fixtures.js";

const agentName = "e2e-gateway-wedge";
const deadSecret = "platform-conn-deleted";

async function waitRunning(api: ApiClient, agentId: string): Promise<void> {
  await expect
    .poll(async () => (await api.agents.get.query({ id: agentId })).state, {
      timeout: 180_000,
      intervals: [2_000],
      message: `agent ${agentId} did not reach running state`,
    })
    .toBe("running");
}

test("a gateway wedged on a deleted credential Secret heals itself (#2817)", async () => {
  test.setTimeout(900_000);

  const token = await getAccessToken();
  const api = createApiClient(token);
  await acceptTerms(api);

  let agentId = "";
  let wedgedRev = "";
  try {
    await test.step("create an agent with a healthy gateway", async () => {
      const created = await api.agents.create.mutate({
        name: agentName,
        templateId: harnessName,
      });
      agentId = created.id;
      await waitRunning(api, agentId);
    });

    const gw = `${agentId}-gateway`;
    await expect
      .poll(() => podIsReady(`${gw}-0`), {
        timeout: 180_000,
        intervals: [2_000],
        message: "gateway pod never became ready",
      })
      .toBe(true);

    await test.step("wedge the gateway on a Secret that does not exist", async () => {
      scaleController(0);
      kubectl(
        "-n",
        AGENT_NS,
        "patch",
        "sts",
        gw,
        "--type=json",
        "-p",
        JSON.stringify([
          {
            op: "add",
            path: "/spec/template/spec/volumes/-",
            value: {
              name: `cred-${deadSecret}`,
              secret: { secretName: deadSecret },
            },
          },
          {
            op: "add",
            path: "/spec/template/spec/containers/0/volumeMounts/-",
            value: {
              name: `cred-${deadSecret}`,
              mountPath: `/etc/envoy/credentials/cred-${deadSecret}`,
              readOnly: true,
            },
          },
        ]),
      );

      await expect
        .poll(() => podField(`${gw}-0`, ".status.phase"), {
          timeout: 180_000,
          intervals: [2_000],
          message: "gateway pod never wedged on the missing Secret",
        })
        .toBe("Pending");
      await expect
        .poll(() => podEvents(`${gw}-0`), {
          timeout: 60_000,
          intervals: [2_000],
          message: "no FailedMount event on the wedged pod",
        })
        .toContain("FailedMount");

      wedgedRev = podField(
        `${gw}-0`,
        ".metadata.labels.controller-revision-hash",
      );
      expect(wedgedRev).not.toBe("");
    });

    await test.step("the controller corrects the desired state", async () => {
      scaleController(1);
      await expect
        .poll(
          () => statefulSetField(gw, ".spec.template.spec.volumes[*].name"),
          {
            timeout: 180_000,
            intervals: [2_000],
            message: "desired template kept the dead Secret reference",
          },
        )
        .not.toContain(deadSecret);
    });

    await test.step("the gateway recovers without operator intervention", async () => {
      await expect
        .poll(() => podIsReady(`${gw}-0`), {
          timeout: 300_000,
          intervals: [3_000],
          message: "wedged gateway never recovered",
        })
        .toBe(true);
      expect(
        podField(`${gw}-0`, ".metadata.labels.controller-revision-hash"),
      ).not.toBe(wedgedRev);
      await expect
        .poll(() => agentConditionStatus(agentId, "Ready"), {
          timeout: 120_000,
          intervals: [2_000],
          message: "agent Ready condition never recovered",
        })
        .toBe("True");
    });
  } finally {
    try {
      scaleController(1);
    } catch {}
    if (agentId) {
      try {
        await api.agents.delete.mutate({ id: agentId });
      } catch {
        deleteAgentCr(agentId);
      }
    }
  }
});
