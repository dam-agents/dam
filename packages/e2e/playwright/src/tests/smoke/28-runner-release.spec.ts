// TEST_OVERVIEW: a runner release reaches an owner's live machines as a hand-off in place, unless the release declares a reboot key its pod does not run, which rolls the pod and reboots them. The vm lane carries one release, so nothing there has ever reached a machine as a second one. This spec gives the lane a second release — the lane's own runner image, declaring a key of its own — and rolls a live guest onto it with the chart's own upgrade, then back onto the install's release. Each roll must show the reboot the release declares, keep the guest's HOME as it was, and leave the agent ready.
import { expect, test } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  type ApiClient,
  createRefreshingApiClient,
} from "../../lib/api-client.js";
import { acceptTerms } from "../../lib/auth.js";
import {
  createAgentOn,
  expectHomeFile,
  inGuest,
  laneBackend,
  refreshingToken,
  requireBackend,
  runnerPod,
  waitAgentState,
  writeHomeFile,
} from "../../lib/backend.js";
import { kubectl, podField, RELEASE, RELEASE_NS } from "../../lib/cluster.js";
import { harnessName } from "../../lib/fixtures.js";

test.skip(laneBackend !== "vm", "only a machine boots a runner release");

test.describe.configure({ mode: "serial" });

const secondKey = "runner-2";
const markerPath = "e2e-runner-release-marker.txt";
const installValues = "/tmp/e2e-runner-release-roll-values.yaml";
const heldForReboot =
  "the release reboots the machines booted before it, so the pod rolls onto it instead of handing off";
const repo = execFileSync("git", ["rev-parse", "--show-toplevel"], {
  cwd: import.meta.dirname,
  encoding: "utf8",
}).trim();

let api: ApiClient;
const token = refreshingToken();
let agentId = "";
const marker = `home-survives-${randomUUID()}`;
let machine = { boot: "", pod: "" };
let installImage = "";
let installRepository = "";
let secondImage = "";
let installMoved = false;

// UNIT_BOUNDARY_DESCRIPTION: the upgrade an operator makes, on the values the install holds. A hop names the runner image it rolls onto; the hop back names none, so the install ends as `cluster:install` made it. The chart's post-upgrade hooks are its own: keycloak's realm import and postgres's roles run on every upgrade and have nothing to do with a runner release, and a hop that waited on them would cost the lane a minute for nothing.
function upgrade(...sets: string[]): void {
  execFileSync(
    "helm",
    [
      "upgrade",
      RELEASE,
      join(repo, "helm"),
      "-n",
      RELEASE_NS,
      "-f",
      installValues,
      "--no-hooks",
      "--force-conflicts",
      ...sets.flatMap((set) => ["--set", set]),
    ],
    { stdio: ["ignore", "inherit", "inherit"] },
  );
}

// UNIT_BOUNDARY_DESCRIPTION: the boot the guest is in, which changes on every boot of the machine, or nothing while the runner that serves it is being replaced.
function guestBoot(): string {
  try {
    return inGuest(agentId, "cat /proc/sys/kernel/random/boot_id").trim();
  } catch {
    return "";
  }
}

function runnerImage(): string {
  return podField(runnerPod(agentId), ".spec.containers[0].image");
}

function controllerLog(since?: string): string {
  const selector = `app.kubernetes.io/instance=${RELEASE},app.kubernetes.io/component=controller`;
  return kubectl(
    "-n",
    RELEASE_NS,
    "logs",
    "-l",
    selector,
    "--tail=-1",
    ...(since ? [`--since-time=${since}`] : []),
  );
}

// UNIT_BOUNDARY_DESCRIPTION: what a hop of the roll must leave behind: a pod of the new release, a boot that is not the one before, HOME as it was, and an agent ready on it. The reconciler's own line, logged since the hop began, says the release rolled the pod, so a reboot for another reason cannot pass for the release reaching the machine, and one hop's line cannot answer for the next.
async function rolledOnto(image: string, since: string): Promise<void> {
  let boot = "";
  await expect
    .poll(
      () => {
        boot = guestBoot();
        return boot !== "" && boot !== machine.boot;
      },
      {
        timeout: 600_000,
        intervals: [5_000],
        message: `the machine did not boot again onto ${image}`,
      },
    )
    .toBe(true);
  await waitAgentState(api, agentId, "running", {
    timeoutMs: 600_000,
    failOnError: false,
  });
  await expect
    .poll(
      () => {
        try {
          return runnerImage();
        } catch {
          return "";
        }
      },
      {
        timeout: 120_000,
        intervals: [2_000],
        message: `the runner pod does not run ${image}`,
      },
    )
    .toBe(image);
  expect(
    runnerPod(agentId),
    "the pod that runs the released runner is not a new one",
  ).not.toBe(machine.pod);
  await expectHomeFile(token, agentId, markerPath, marker, {
    timeoutMs: 120_000,
  });
  expect(
    controllerLog(since),
    `the pod did not roll because ${image} declares a reboot`,
  ).toContain(heldForReboot);
  machine = { boot, pod: runnerPod(agentId) };
}

test.beforeAll(async () => {
  test.setTimeout(900_000);
  api = createRefreshingApiClient(token);
  await requireBackend(api, laneBackend);
  await acceptTerms(api);
  writeFileSync(
    installValues,
    execFileSync(
      "helm",
      ["get", "values", RELEASE, "-n", RELEASE_NS, "-o", "yaml"],
      { encoding: "utf8" },
    ),
  );
  agentId = await createAgentOn(
    api,
    laneBackend,
    "e2e-runner-release",
    harnessName,
    { neverIdle: true },
  );
  await waitAgentState(api, agentId, "running", { timeoutMs: 600_000 });
  const pod = runnerPod(agentId);
  test.skip(pod === "", "the Mac's host runner runs outside the cluster");
  installImage = runnerImage();
  installRepository = installImage.split("@")[0].replace(/:[^/]*$/, "");
  expect(
    installImage.endsWith(`:${secondKey}`),
    `the install already runs ${secondKey}; put the chart back on its own values before a run`,
  ).toBe(false);
  machine = { boot: guestBoot(), pod };
  expect(
    machine.boot,
    "the guest did not answer for the boot it is in",
  ).not.toBe("");
  await writeHomeFile(token, agentId, markerPath, marker);
  await expectHomeFile(token, agentId, markerPath, marker, {
    timeoutMs: 60_000,
  });
  const printed = execFileSync(
    "mise",
    ["run", "e2e:runner-release", "--", secondKey],
    { cwd: repo, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] },
  );
  secondImage = (printed.trim().split("\n").pop() ?? "").trim();
  expect(
    secondImage,
    "e2e:runner-release did not load the lane's runner image under the second key",
  ).toBe(`${installRepository}:${secondKey}`);
});

test.afterAll(async () => {
  test.setTimeout(600_000);
  try {
    if (installMoved) upgrade();
  } finally {
    if (agentId) await api.agents.delete.mutate({ id: agentId });
  }
});

// TEST_SCENARIO: a release that declares a reboot key the pod does not run cannot be handed to the machines that pod boots, so the pod rolls onto the image carrying it and every machine it runs reboots. The agent's guest is live with a file in HOME when the chart is upgraded to that release, so the roll reaches a running machine and must bring it back on a new boot with its disk as it was.
test("rolls the live guest onto a release that declares a reboot", async () => {
  test.setTimeout(1_500_000);
  expect(
    guestBoot(),
    "the machine is on another boot than the one the hop starts from",
  ).toBe(machine.boot);
  const since = new Date().toISOString();
  installMoved = true;
  upgrade(
    `virtualization.runner.image.repository=${installRepository}`,
    `virtualization.runner.image.tag=${secondKey}`,
    "virtualization.runner.image.digest=",
  );
  await rolledOnto(secondImage, since);
});

// TEST_SCENARIO: the install's own release carries the key before the second one's, so the hop back is a release that declares a reboot of its own, and the machine reboots again. The chart is upgraded on the values the install holds, with nothing named, which is how an operator leaves a release.
test("rolls it back onto the release the install holds", async () => {
  test.setTimeout(1_500_000);
  expect(
    guestBoot(),
    "the machine is on another boot than the one the hop starts from",
  ).toBe(machine.boot);
  const since = new Date().toISOString();
  upgrade();
  installMoved = false;
  await rolledOnto(installImage, since);
});
