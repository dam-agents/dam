// TEST_OVERVIEW: a runner release reaches an owner's live machines as a hand-off in place, unless the release declares a reboot key its pod does not run, which rolls the pod and reboots them. The install carries one release, so nothing there has ever reached a machine as a second one. This spec gives the install a second release — its own runner image, declaring a key of its own — and rolls a live guest onto it with the chart's own upgrade, then back onto the install's release. Each roll must show the reboot the release declares, keep the guest's HOME as it was, and leave the agent ready.
import { expect, test } from "@playwright/test";
import { execFile, execFileSync } from "node:child_process";
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
  refreshingToken,
  runnerPod,
  waitAgentState,
  writeHomeFile,
} from "../../lib/backend.js";
import {
  AGENT_NS,
  kubectl,
  kubectlOrEmpty,
  podField,
  RELEASE,
  RELEASE_NS,
} from "../../lib/cluster.js";
import { harnessName } from "../../lib/fixtures.js";
import { keepAwake } from "../../lib/keep-awake.js";

test.describe.configure({ mode: "serial" });

const derivedMarker = "-e2e";
const markerPath = "e2e-runner-release-marker.txt";
const installValues = "/tmp/e2e-runner-release-roll-values.yaml";
const heldForReboot =
  "the release reboots the machines booted before it, so the pod rolls onto it instead of handing off";
// UNIT_BOUNDARY_DESCRIPTION: a Deployment as one row of what its own rollout claims: name, generation, observed generation, desired pods, pods, updated pods, ready pods, the image its template carries, the release it has named to its runner, and the machines a roll is still bringing back. Read off the object, so a comparison cannot be answered by whichever pods happen to exist.
const deploymentRows =
  'jsonpath={range .items[*]}{.metadata.name}{"|"}{.metadata.generation}{"|"}{.status.observedGeneration}{"|"}{.spec.replicas}{"|"}{.status.replicas}{"|"}{.status.updatedReplicas}{"|"}{.status.readyReplicas}{"|"}{.spec.template.spec.containers[0].image}{"|"}{.metadata.annotations.agent-platform\\.ai/runner-release}{"|"}{.metadata.annotations.agent-platform\\.ai/runner-awaiting}{"\\n"}{end}';
// UNIT_BOUNDARY_DESCRIPTION: the release stager as one row of the same shape minus the annotations: generation, observed generation, desired nodes, updated nodes, ready nodes and the image it stages.
const daemonsetRows =
  'jsonpath={range .items[*]}{.metadata.generation}{"|"}{.status.observedGeneration}{"|"}{.status.desiredNumberScheduled}{"|"}{.status.updatedNumberScheduled}{"|"}{.status.numberReady}{"|"}{.spec.template.spec.containers[0].image}{"\\n"}{end}';
const repo = execFileSync("git", ["rev-parse", "--show-toplevel"], {
  cwd: import.meta.dirname,
  encoding: "utf8",
}).trim();

let api: ApiClient;
const token = refreshingToken();
let agentId = "";
const marker = `home-survives-${randomUUID()}`;
let machine = { boot: "", pod: "" };
let owner = "";
let secondKey = "";
let installImage = "";
let installRepository = "";
let secondImage = "";
let installMoved = false;
let keeping: ReturnType<typeof keepAwake> | undefined;

// UNIT_BOUNDARY_DESCRIPTION: the second runner image is built with an awaited child rather than a synchronous one, because the keep-awake timer runs on the spec's own event loop: a synchronous build blocks timer callbacks, token refresh and HTTP requests until it returns, so a build that outlasts the lane's 5m `vmIdleTimeout` would let the machine hibernate even though the timer exists. The build's own output stays on this process's stderr, where the run's log already has it.
async function buildSecondRelease(key: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      "mise",
      ["run", "e2e:runner-release", "--", key],
      { cwd: repo, maxBuffer: 16 * 1024 * 1024 },
      (error, stdout) =>
        error
          ? reject(error)
          : resolve((stdout.trim().split("\n").pop() ?? "").trim()),
    ).stderr?.pipe(process.stderr);
  });
}

// UNIT_BOUNDARY_DESCRIPTION: the upgrade an operator makes, on the values the install holds. A hop names the runner image it rolls onto; the hop back names none, so the install ends as `cluster:install` made it. The chart's post-upgrade hooks are its own: keycloak's realm import and postgres's roles run on every upgrade and have nothing to do with a runner release, and a hop that waited on them would cost the run a minute for nothing.
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

function lines(out: string): string[] {
  return out.split("\n").filter((row) => row !== "");
}

// UNIT_BOUNDARY_DESCRIPTION: what is not back yet about a Deployment's own rollout, read off the object rather than its pods: a template the cluster has not applied, pods that are not all the current revision and ready, an image other than the release that must run, a release named that is not that release, or a roll still bringing machines back. A runner that named the install's own release is left as it is, which is what a healthy runner holds; old ready pods therefore cannot answer for a replacement that is still coming.
function notRolled(row: string, image: string | undefined): string {
  const [
    name,
    gen,
    observed,
    wanted,
    pods,
    updated,
    ready,
    seen,
    named,
    awaiting,
  ] = row.split("|");
  if (observed !== gen) return `${name} has not applied its own template yet`;
  const replicas = wanted === "" ? 1 : Number(wanted);
  if (
    Number(pods) !== replicas ||
    Number(updated) !== replicas ||
    Number(ready) !== replicas
  )
    return `${name} runs ${pods || 0} pods, ${updated || 0} updated and ${ready || 0} ready of ${replicas}`;
  if (image !== undefined && seen !== image)
    return `${name} carries ${seen}, not ${image}`;
  if (named !== "" && named !== image)
    return `${name} has ${named} named as its release`;
  if (awaiting !== "") return `${name} is still bringing machines back`;
  return "";
}

// UNIT_BOUNDARY_DESCRIPTION: the install back on the release `cluster:install` put it on, read off the cluster alone, so a run that failed before it made an agent can still tell. A helm upgrade patches the templates while the pods that take them roll afterwards, and the controller reads its runner release from its own environment, so the values alone prove nothing: this waits until the restored controller and stager are the ones running and every runner has rolled onto the install's image with no other release named and no roll in flight. What it answers is what is not back yet, so a timeout names the state that stayed.
async function expectInstallRestored(): Promise<void> {
  await expect
    .poll(
      () => {
        try {
          const controller = lines(
            kubectl(
              "-n",
              RELEASE_NS,
              "get",
              "deployment",
              "-l",
              `app.kubernetes.io/instance=${RELEASE},app.kubernetes.io/component=controller`,
              "-o",
              deploymentRows,
            ),
          );
          if (controller.length === 0) return "the install has no controller";
          for (const row of controller) {
            const fault = notRolled(row, undefined);
            if (fault !== "") return fault;
          }
          const stager = lines(
            kubectl(
              "-n",
              AGENT_NS,
              "get",
              "daemonset",
              "-l",
              `app.kubernetes.io/instance=${RELEASE},app.kubernetes.io/component=vm-runner-releases`,
              "-o",
              daemonsetRows,
            ),
          );
          if (stager.length === 0) return "the install has no release stager";
          for (const row of stager) {
            const [gen, observed, wanted, updated, ready, seen] =
              row.split("|");
            if (observed !== gen)
              return "the stager has not applied its template yet";
            if (updated !== wanted || ready !== wanted)
              return `the stager is ${ready || 0} of ${wanted || 0} ready, ${updated || 0} updated`;
            if (seen !== installImage)
              return `the stager carries ${seen}, not ${installImage}`;
          }
          const runners = lines(
            kubectl(
              "-n",
              AGENT_NS,
              "get",
              "deployment",
              "-l",
              "app.kubernetes.io/component=vm-runner",
              "-o",
              deploymentRows,
            ),
          );
          if (runners.length === 0) return "no runner is running";
          for (const row of runners) {
            const fault = notRolled(row, installImage);
            if (fault !== "") return fault;
          }
          return "";
        } catch (error) {
          return String(error);
        }
      },
      { timeout: 600_000, intervals: [5_000] },
    )
    .toBe("");
}

// UNIT_BOUNDARY_DESCRIPTION: how many lines each controller pod has logged saying that this release reboots this owner's machines, counting only this owner and this release, so one owner's roll cannot answer for another's. A hop compares one snapshot with another, so a line an earlier run left cannot answer for this hop, and no machine's clock is compared with another's. A pod is keyed by its own name, which a reused counter would lose: a controller that rolls during the hop answers with its own fresh lines. Nothing is answered when the read failed or a line carries no kubectl `[pod/<name>/<container>]` prefix to attribute it by, so a read the counter could not make never passes for a quiet log.
function rebootLines(image: string): Map<string, number> | undefined {
  const selector = `app.kubernetes.io/instance=${RELEASE},app.kubernetes.io/component=controller`;
  let out: string;
  try {
    out = kubectl(
      "-n",
      RELEASE_NS,
      "logs",
      "-l",
      selector,
      "-c",
      "controller",
      "--prefix=true",
      "--tail=-1",
    );
  } catch (cause) {
    console.log(`[e2e] the controller log read failed: ${String(cause)}`);
    return undefined;
  }
  let onlyPod = "";
  const seen = new Map<string, number>();
  for (const logged of out.split("\n")) {
    if (
      !logged.includes(heldForReboot) ||
      !logged.includes(`"owner":"${owner}"`) ||
      !logged.includes(`"release":"${image}"`)
    )
      continue;
    const prefixed = /^\[[^/\]]+\/([^/\]]+)\/[^/\]]+\] /.exec(logged)?.[1];
    if (prefixed !== undefined) {
      seen.set(prefixed, (seen.get(prefixed) ?? 0) + 1);
      continue;
    }
    if (onlyPod === "")
      onlyPod = kubectlOrEmpty(
        "-n",
        RELEASE_NS,
        "get",
        "pods",
        "-l",
        selector,
        "-o",
        "jsonpath={.items[0].metadata.name}",
      ).trim();
    if (onlyPod === "") {
      console.log(`[e2e] an unattributable controller line: ${logged}`);
      return undefined;
    }
    seen.set(onlyPod, (seen.get(onlyPod) ?? 0) + 1);
  }
  return seen;
}

// UNIT_BOUNDARY_DESCRIPTION: the counter before a hop, retried so one failed read does not fail the hop, and never a baseline a later read could mistake for zero: a hop whose baseline could not be read fails instead of passing.
async function linesBefore(image: string): Promise<Map<string, number>> {
  let counts = new Map<string, number>();
  await expect
    .poll(
      () => {
        const snapshot = rebootLines(image);
        if (snapshot === undefined) return false;
        counts = snapshot;
        return true;
      },
      {
        timeout: 60_000,
        intervals: [2_000],
        message: "the controller's log could not be read before the hop",
      },
    )
    .toBe(true);
  return counts;
}

// UNIT_BOUNDARY_DESCRIPTION: what a hop of the roll must leave behind: a pod of the new release, a boot that is not the one before, HOME as it was, and an agent ready on it. A line the reconciler logs for this owner and release that no pod had logged before the hop says the release rolled the pod, so a reboot for another reason cannot pass for the release reaching the machine, and one hop's line cannot answer for the next.
async function rolledOnto(
  image: string,
  loggedBefore: Map<string, number>,
): Promise<void> {
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
  await expect
    .poll(
      () =>
        [...(rebootLines(image)?.entries() ?? [])].some(
          ([pod, count]) => count > (loggedBefore.get(pod) ?? 0),
        ),
      {
        timeout: 120_000,
        intervals: [5_000],
        message: `the controller did not log that ${image} reboots this owner's machines`,
      },
    )
    .toBe(true);
  machine = { boot, pod: runnerPod(agentId) };
}

test.beforeAll(async () => {
  test.setTimeout(900_000);
  api = createRefreshingApiClient(token);
  await acceptTerms(api);
  writeFileSync(
    installValues,
    execFileSync(
      "helm",
      ["get", "values", RELEASE, "-n", RELEASE_NS, "-o", "yaml"],
      { encoding: "utf8" },
    ),
  );
  agentId = await createAgentOn(api, "e2e-runner-release", harnessName, {
    neverIdle: true,
  });
  await waitAgentState(api, agentId, "running", { timeoutMs: 600_000 });
  const pod = runnerPod(agentId);
  test.skip(pod === "", "the Mac's host runner runs outside the cluster");
  keeping = keepAwake(() => api.agents.wake.mutate({ id: agentId }));
  installImage = runnerImage();
  installRepository = installImage.split("@")[0].replace(/:[^/]*$/, "");
  owner = podField(pod, ".metadata.labels.agent-platform\\.ai/owner");
  const rebootKey = kubectl(
    "-n",
    AGENT_NS,
    "exec",
    pod,
    "-c",
    "vm-runner",
    "--",
    "cat",
    "/usr/local/libexec/vm-runner/reboot-id",
  ).trim();
  expect(
    [installImage, rebootKey].filter((seen) => seen.endsWith(derivedMarker)),
    "an earlier run left the install on its derived release; put the chart back on its own values before a run",
  ).toEqual([]);
  secondKey = `${rebootKey}${derivedMarker}`;
  machine = { boot: guestBoot(), pod };
  expect(
    machine.boot,
    "the guest did not answer for the boot it is in",
  ).not.toBe("");
  await writeHomeFile(token, agentId, markerPath, marker);
  await expectHomeFile(token, agentId, markerPath, marker, {
    timeoutMs: 60_000,
  });
  secondImage = await buildSecondRelease(secondKey);
  expect(
    secondImage,
    "e2e:runner-release did not load the install's runner image under the second key",
  ).toBe(`${installRepository}:${secondKey}`);
});

test.afterAll(async () => {
  test.setTimeout(1_500_000);
  try {
    if (installMoved) {
      upgrade();
      await expectInstallRestored();
      installMoved = false;
    }
  } finally {
    keeping?.stop();
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
  const before = await linesBefore(secondImage);
  installMoved = true;
  upgrade(
    `virtualization.runner.image.repository=${installRepository}`,
    `virtualization.runner.image.tag=${secondKey}`,
    "virtualization.runner.image.digest=",
  );
  await rolledOnto(secondImage, before);
});

// TEST_SCENARIO: the install's own release carries the key before the second one's, so the hop back is a release that declares a reboot of its own, and the machine reboots again. The chart is upgraded on the values the install holds, with nothing named, which is how an operator leaves a release.
test("rolls it back onto the release the install holds", async () => {
  test.setTimeout(1_500_000);
  expect(
    guestBoot(),
    "the machine is on another boot than the one the hop starts from",
  ).toBe(machine.boot);
  const before = await linesBefore(installImage);
  upgrade();
  await rolledOnto(installImage, before);
  installMoved = false;
});
