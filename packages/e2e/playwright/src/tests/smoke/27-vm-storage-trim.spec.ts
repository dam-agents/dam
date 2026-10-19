// TEST_OVERVIEW: the room a vm agent frees goes back to its owner's storage. A machine's disk is a sparse file on the owner's claim, so a file the agent deletes keeps its blocks on the claim until the guest's filesystem discards them, and platform-init is what trims them back (FITRIM): every minute, and before its storage guard preallocates the extents the guest just freed, since a preallocated extent is allocated and no trim reaches it afterwards. Without that trim the claim only ever grows, and everything the owner is shown and refused for — the storage bar, the 90% create refusal, the 95% start refusal, the alerts — reads the claim. Only the vm lane runs this spec, and it measures the disk files on the agent's runner claim: write 300 MiB in the guest, delete it, and the claim gives the room back within two minutes.
import { expect, test } from "@playwright/test";

import {
  type ApiClient,
  createRefreshingApiClient,
} from "../../lib/api-client.js";
import { acceptTerms } from "../../lib/auth.js";
import {
  createAgentOn,
  inGuest,
  refreshingToken,
  requireBackend,
  runnerPod,
  waitAgentState,
} from "../../lib/backend.js";
import { AGENT_NS, kubectl } from "../../lib/cluster.js";
import { harnessName } from "../../lib/fixtures.js";

const PROBE = "/home/agent/e2e-storage-trim-probe";
const PROBE_MIB = 300;
const SLACK_MIB = 60;
const PROBE_TIMEOUT_MS = 150_000;

test.describe.configure({ mode: "serial" });

let api: ApiClient;
const token = refreshingToken();
let agentId = "";

function claimMiB(): number {
  const du = kubectl(
    "-n",
    AGENT_NS,
    "exec",
    runnerPod(agentId),
    "-c",
    "vm-runner",
    "--",
    "sh",
    "-c",
    'du -s --block-size=1M "$HOME/.cache/smolvm/vms"',
  );
  return Number(du.split("\t")[0]);
}

async function waitForClaim(
  fits: (mib: number) => boolean,
  what: string,
): Promise<number> {
  const deadline = Date.now() + PROBE_TIMEOUT_MS;
  for (;;) {
    const claimed = claimMiB();
    if (fits(claimed)) return claimed;
    expect(Date.now(), `${what}: the claim holds ${claimed} MiB`).toBeLessThan(
      deadline,
    );
    await new Promise((resolve) => setTimeout(resolve, 5_000));
  }
}

test.beforeAll(async () => {
  test.setTimeout(600_000);
  api = createRefreshingApiClient(token);
  await requireBackend(api, "vm");
  await acceptTerms(api);
  agentId = await createAgentOn(api, "vm", "e2e-storage-trim", harnessName, {
    neverIdle: true,
  });
  await waitAgentState(api, agentId, "running");
});

test.afterAll(async () => {
  if (agentId) await api.agents.delete.mutate({ id: agentId });
});

// TEST_SCENARIO: an agent writes 300 MiB of random bytes, which compression cannot shrink, and deletes them. The claim must take them first and give them back after the delete: a claim that keeps them is room no message the owner is shown can free, since only deleting a whole agent frees a disk.
test("room a vm agent frees goes back to its owner's claim", async () => {
  test.setTimeout(600_000);
  test.skip(
    !runnerPod(agentId),
    "the Mac's host runner runs outside the cluster",
  );
  const before = claimMiB();
  inGuest(agentId, `head -c ${PROBE_MIB}M /dev/urandom > ${PROBE} && sync`);
  const written = await waitForClaim(
    (mib) => mib >= before + PROBE_MIB - SLACK_MIB,
    "the probe never reached the claim",
  );
  inGuest(agentId, `rm -f ${PROBE} && sync`);
  await waitForClaim(
    (mib) => mib <= written - PROBE_MIB + SLACK_MIB,
    "the deleted probe never left the claim",
  );
});
