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

// Full-suite-only spec (see playwright.config.ts): run on demand with
// `mise run e2e:loop -- --full`.
//
// #2817: disconnecting a connection deletes its Secret, and a gateway roll
// already in flight can carry the reference past the deletion. The mount is
// mandatory, so that pod never starts — and Kubernetes will not replace a
// not-ready pod with the corrected revision that lands seconds later, so the
// agent keeps its gateway Service and loses all egress until an operator
// deletes the pod by hand.
//
// The race is not reproducible on demand, so this manufactures the state it
// produces and asserts the platform gets out of it unaided. This must be an
// e2e test: the deadlock lives entirely in behaviour a fake client cannot
// model — kubelet failing a mandatory Secret mount, the StatefulSet's
// OrderedReady monotonic invariant, and Kubernetes reusing an earlier
// revision when a template reverts.
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
    // Agent state "running" tolerates a gateway that is still rolling, so wait
    // on the gateway pod itself before touching it.
    await expect
      .poll(() => podIsReady(`${gw}-0`), {
        timeout: 180_000,
        intervals: [2_000],
        message: "gateway pod never became ready",
      })
      .toBe(true);

    // Parking the controller stands in for the render window the real race
    // opens; without it the controller can restore the good template before
    // the StatefulSet recreates the pod, and no wedge forms. Cluster-wide, so
    // the finally below always undoes it.
    await test.step("wedge the gateway on a Secret that does not exist", async () => {
      scaleController(0);
      // Volume *and* mount: kubelet never resolves a volume no container
      // mounts, so the volume alone would not wedge anything.
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

      // Recorded while the controller is parked, so it is stable: the fix has
      // to move the pod off this revision, and only an eviction can.
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
      // Before the fix this never happens: the pod sits Pending forever on a
      // revision that is neither current nor update, and only a manual pod
      // delete recovers the agent's egress.
      await expect
        .poll(() => podIsReady(`${gw}-0`), {
          timeout: 300_000,
          intervals: [3_000],
          message: "wedged gateway never recovered",
        })
        .toBe(true);
      // Replaced, not revived in place.
      expect(
        podField(`${gw}-0`, ".metadata.labels.controller-revision-hash"),
      ).not.toBe(wedgedRev);
      // And the platform's own view of the agent is healthy again.
      await expect
        .poll(() => agentConditionStatus(agentId, "Ready"), {
          timeout: 120_000,
          intervals: [2_000],
          message: "agent Ready condition never recovered",
        })
        .toBe("True");
    });
  } finally {
    // Nothing here may throw: on failure the assertion above is the story, and
    // a cleanup error would replace it. Restoring the controller matters most —
    // leaving it parked would break every later spec.
    try {
      scaleController(1);
    } catch {
      /* already restored, or the cluster is gone */
    }
    if (agentId) {
      try {
        await api.agents.delete.mutate({ id: agentId });
      } catch {
        deleteAgentCr(agentId);
      }
    }
  }
});
