// TEST_OVERVIEW: platform-init is a machine's PID 1 and the only holder of its agent's home, so a boot cut short must never cost the owner what is on the disk. This spec breaks a boot the ways a host failure, a full disk and a lost file do — it kills the machine's VMM at points across a boot, fills the disk the next boot finds, and empties the layout mark an unclean stop can leave empty — and it must always end in one of two states: the machine boots with the file in HOME readable, or it refuses to boot while saying why. Only the vm lane runs it, and its last test also needs an owner's claim with a size of its own, which the lane's provisioner does not give it; the config runs it beside the other specs that boot their own agent.
import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";

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
  onRunnerHost,
  refreshingToken,
  requireBackend,
  waitAgentState,
  writeHomeFile,
} from "../../lib/backend.js";
import { harnessName } from "../../lib/fixtures.js";

test.describe.configure({ mode: "serial" });

const markerPath = "e2e-boot-matrix-marker.txt";

const KILL_POINTS = [0.2, 0.4, 0.6, 0.85];

let api: ApiClient;
const token = refreshingToken();
let agentId = "";
const marker = `home-survives-${randomUUID()}`;

function millis(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// UNIT_BOUNDARY_DESCRIPTION: the fields of one `df -Pk` row: 1024-block size, used and available, then the capacity as a percentage.
function capacityOf(dfRow: string): number {
  const fields = dfRow.trim().split(/\s+/);
  return Number((fields[4] ?? "0%").replace("%", ""));
}

async function hibernate(): Promise<void> {
  await api.agents.sleep.mutate({ id: agentId });
  await waitAgentState(api, agentId, "hibernated");
}

async function bootAndTime(): Promise<number> {
  await hibernate();
  const started = Date.now();
  await api.agents.wake.mutate({ id: agentId });
  await waitAgentState(api, agentId, "running", { timeoutMs: 300_000 });
  return Date.now() - started;
}

// UNIT_BOUNDARY_DESCRIPTION: SIGKILLs the VMM of this agent's machine and answers how many it killed. A VMM is the runner's `_boot-vm` child, given the boot config of one machine, and that config names the machine's share under its owner's state directory, so the process is picked by the agent id rather than by being the only one running: another agent of the same owner may be up beside it. The patterns are bracketed so they cannot match the shell that runs them.
function killMachineVMM(id: string): number {
  const out = onRunnerHost(
    id,
    [
      "killed=0",
      "for p in /proc/[0-9]*; do",
      '  [ -r "$p/cmdline" ] || continue',
      '  cfg=$(tr "\\0" "\\n" < "$p/cmdline" 2>/dev/null | grep -e "boot-config[.]json" | head -1)',
      '  [ -n "$cfg" ] && [ -r "$cfg" ] || continue',
      `  grep -q "machines/${id}/" "$cfg" || continue`,
      '  kill -9 "${p#/proc/}" && killed=$((killed + 1))',
      "done",
      'echo "$killed"',
    ].join("\n"),
  );
  return Number(out.trim());
}

test.beforeAll(async () => {
  test.setTimeout(300_000);
  api = createRefreshingApiClient(token);
  await requireBackend(api, laneBackend);
  await acceptTerms(api);
  agentId = await createAgentOn(
    api,
    laneBackend,
    "e2e-boot-matrix",
    harnessName,
    {
      neverIdle: true,
    },
  );
  await waitAgentState(api, agentId, "running");
  await writeHomeFile(token, agentId, markerPath, marker);
  await expectHomeFile(token, agentId, markerPath, marker, {
    timeoutMs: 60_000,
  });
});

test.afterAll(async () => {
  if (agentId) await api.agents.delete.mutate({ id: agentId });
});

// TEST_SCENARIO: a VMM that dies on the host — a kernel bug, a seccomp kill, an operator — takes the machine with it but must leave the disk as a boot can read it. The agent's machine is killed at four points across a boot its own lane measured, and after each the agent must come back to running with the file in HOME unchanged: the runner restarts a guest that stopped answering, and platform-init seeds nothing over a home that is already on the disk.
test("comes back from its VMM being killed at points across a boot", async () => {
  test.setTimeout(1_200_000);
  const clean = await bootAndTime();
  console.log(`[e2e] a clean boot of ${agentId} took ${clean}ms`);
  for (const point of KILL_POINTS) {
    await hibernate();
    await api.agents.wake.mutate({ id: agentId });
    await millis(Math.round(clean * point));
    const state = (await api.agents.get.query({ id: agentId })).state;
    const killed = killMachineVMM(agentId);
    console.log(
      `[e2e] killed ${killed} VMM(s) ${Math.round(point * 100)}% into a boot; the agent read ${state}`,
    );
    expect(
      killed,
      `no VMM of ${agentId} was running ${Math.round(point * 100)}% into a ${clean}ms boot`,
    ).toBeGreaterThan(0);
    await waitAgentState(api, agentId, "running", {
      timeoutMs: 600_000,
      failOnError: false,
    });
    await expectHomeFile(token, agentId, markerPath, marker, {
      timeoutMs: 120_000,
    });
  }
});

// TEST_SCENARIO: a disk with no block left costs a boot the empty work layer it needs before it mounts anything. platform-init gives back only what a boot discards — its scratch folders and the layers earlier boots set aside — and then boots with the home untouched, so the agent comes back without anyone having to free room from outside a machine that cannot boot. The filler sits in /tmp, which a boot empties anyway; the same fill in HOME is a boot that must refuse and say the home is full, which the runner's own tests cover.
test("boots a disk it found with no room left", async () => {
  test.setTimeout(600_000);
  const fill = inGuest(
    agentId,
    [
      "df -Pk /tmp | tail -1",
      "i=0",
      "while [ $i -lt 64 ]; do",
      "  dd if=/dev/urandom of=/tmp/boot-matrix-fill.$i bs=1M count=64 2>/dev/null || break",
      "  i=$((i+1))",
      "done",
      "sync",
      "df -Pk /tmp | tail -1",
    ].join("\n"),
  );
  const [before = "", after = ""] = fill.trim().split("\n");
  console.log(`[e2e] the machine's disk before the fill: ${before}`);
  console.log(`[e2e] the machine's disk when the fill stopped: ${after}`);
  expect(capacityOf(after), `the disk was not filled: ${after}`).toBe(100);

  await hibernate();
  await api.agents.wake.mutate({ id: agentId });
  await waitAgentState(api, agentId, "running", {
    timeoutMs: 600_000,
    failOnError: false,
  });
  await expectHomeFile(token, agentId, markerPath, marker, {
    timeoutMs: 120_000,
  });
  expect(
    inGuest(agentId, "ls -A /tmp").includes("boot-matrix-fill"),
    "the boot kept the scratch of the boot before it",
  ).toBe(false);
});

// TEST_SCENARIO: a disk with no journal can lose a file's bytes to an unclean stop and keep its name, so the layout mark can come back empty. platform-init counts an empty mark as no mark, writes it again and boots the home as it is, instead of refusing a disk it cannot place or, worse, reading it by the wrong names. The mark is emptied the way an operator would, from a second mount of the same disk in the guest, because the machine's own copy of it is detached once it has booted.
test("boots on a disk whose layout mark came back empty", async () => {
  test.setTimeout(600_000);
  const emptied = inGuest(
    agentId,
    [
      "mkdir -p /mnt/boot-matrix-disk",
      "mount -t btrfs -o compress=zstd:1 /dev/vda /mnt/boot-matrix-disk",
      'echo "mark $(cat /mnt/boot-matrix-disk/system/layout)"',
      "truncate -s 0 /mnt/boot-matrix-disk/system/layout",
      "sync",
      'echo "emptied $(wc -c < /mnt/boot-matrix-disk/system/layout)"',
      "umount /mnt/boot-matrix-disk",
      "rmdir /mnt/boot-matrix-disk",
    ].join("\n"),
  );
  expect(emptied, "the boot marked the disk as layout 2").toMatch(/^mark 2$/m);
  expect(emptied, "the layout mark read back empty").toMatch(/^emptied 0$/m);

  await hibernate();
  await api.agents.wake.mutate({ id: agentId });
  await waitAgentState(api, agentId, "running", {
    timeoutMs: 600_000,
    failOnError: false,
  });
  await expectHomeFile(token, agentId, markerPath, marker, {
    timeoutMs: 120_000,
  });
  const remarked = inGuest(
    agentId,
    [
      "mkdir -p /mnt/boot-matrix-disk",
      "mount -t btrfs -o compress=zstd:1 /dev/vda /mnt/boot-matrix-disk",
      'echo "mark $(cat /mnt/boot-matrix-disk/system/layout)"',
      "umount /mnt/boot-matrix-disk",
      "rmdir /mnt/boot-matrix-disk",
    ].join("\n"),
  );
  expect(remarked, "the boot marked the emptied disk again").toMatch(
    /^mark 2$/m,
  );
});

// TEST_SCENARIO: an owner's claim with no room left refuses a machine's start rather than letting its guest write into a disk the claim has no block for, and the owner is told which storage is full. The filler is this spec's own file on the claim, so it comes back off with one command once the refusal is seen, and the agent boots with HOME intact. The claim must have a filesystem of its own to be filled at all: the lane's local-path provisioner hands out a directory of the node's disk, so there the guard watches the node and a fill would fill the CI node, and E2E_CLAIM_FILL_GIB is how a run against an install whose claim is its own volume (a Ceph RBD, a loop device) opts in, with the most it may write onto the claim; unset, the case is skipped rather than run at the node's expense.
test("refuses a start while the owner's claim is full", async () => {
  test.setTimeout(600_000);
  const capGiB = Number(process.env.E2E_CLAIM_FILL_GIB ?? "");
  test.skip(
    !Number.isFinite(capGiB) || capGiB <= 0,
    "the lane's claim is a directory of the node's disk, so filling it would fill the node; set E2E_CLAIM_FILL_GIB against an install whose claim is its own volume",
  );
  const filled = onRunnerHost(
    agentId,
    [
      'set -- $(df -Pk "$HOME" | tail -1)',
      "used=$3",
      "avail=$4",
      "need=$(( ((used + avail) * 97 / 100) - used ))",
      `cap=${Math.round(capGiB)} * 1024 * 1024`,
      'if [ "$need" -gt "$cap" ]; then',
      '  echo "cannot $need $cap"',
      "  exit 0",
      "fi",
      'fallocate -l "${need}K" "$HOME/e2e-claim-fill" || dd if=/dev/zero of="$HOME/e2e-claim-fill" bs=1024 count="$need" 2>/dev/null || true',
      "sync",
      'df -Pk "$HOME" | tail -1',
    ].join("\n"),
  );
  const [verdict = "", row = ""] = filled.trim().split("\n");
  test.skip(
    verdict.startsWith("cannot "),
    `the claim's filesystem is too big to fill under the cap: ${verdict}`,
  );
  console.log(`[e2e] the owner's claim when the fill stopped: ${row}`);
  expect(
    capacityOf(row),
    `the claim was not filled: ${row}`,
  ).toBeGreaterThanOrEqual(95);
  try {
    await hibernate();
    await api.agents.wake
      .mutate({ id: agentId })
      .catch((e: Error) =>
        console.log(`[e2e] the wake was refused outright: ${e.message}`),
      );
    await waitAgentState(api, agentId, "error", { timeoutMs: 300_000 });
    expect(
      (await api.agents.get.query({ id: agentId })).podTerminationCode,
      "the runner refused the start for the full claim",
    ).toBe("MachineStorageFull");
  } finally {
    onRunnerHost(agentId, 'rm -f "$HOME/e2e-claim-fill"');
  }
  await api.agents.wake.mutate({ id: agentId });
  await waitAgentState(api, agentId, "running", { timeoutMs: 600_000 });
  await expectHomeFile(token, agentId, markerPath, marker, {
    timeoutMs: 120_000,
  });
});
