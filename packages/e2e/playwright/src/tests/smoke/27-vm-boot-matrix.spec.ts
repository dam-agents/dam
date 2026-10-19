// TEST_OVERVIEW: platform-init is a machine's PID 1 and the only holder of its agent's home, so a boot cut short must never cost the owner what is on the disk. This spec breaks a boot the ways a host failure does — it kills the machine's VMM at points across a boot and empties the layout mark an unclean stop can leave empty — and it must always end in one of two states: the machine boots with the file in HOME readable, or it refuses to boot while saying why. Two more cases need room the lane's node cannot spare, a disk with no block left and an owner's claim with none, so a run opts into them by environment, and the second needs a claim with a size of its own, which the lane's provisioner does not give it. Only the vm lane runs it, and the config runs it beside the other specs that boot their own agent.
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

const KILL_DELAYS_MS = [0, 100, 250, 400];

let api: ApiClient;
const token = refreshingToken();
let agentId = "";
const marker = `home-survives-${randomUUID()}`;

// UNIT_BOUNDARY_DESCRIPTION: the fields of one `df -Pk` row: 1024-block size, used and available, then the capacity as a percentage.
function capacityOf(dfRow: string): number {
  const fields = dfRow.trim().split(/\s+/);
  return Number((fields[4] ?? "0%").replace("%", ""));
}

// UNIT_BOUNDARY_DESCRIPTION: the line of a helper script's output that follows its marker. The runner hands back stdout alone, so every script this spec runs prints a marker line before each piece of data it means to be read: a script's output read by the line it happens to land on breaks the moment the script prints one more or one fewer line before it.
function after(output: string, marker: string): string {
  const lines = output.split("\n");
  const at = lines.indexOf(marker);
  return at === -1 ? "" : (lines[at + 1] ?? "").trim();
}

async function hibernate(): Promise<void> {
  await api.agents.sleep.mutate({ id: agentId });
  await waitAgentState(api, agentId, "hibernated");
}

// UNIT_BOUNDARY_DESCRIPTION: starts on the runner a watcher that waits for this machine's own VMM to appear, SIGKILLs it the given delay after it appeared, and writes one line for the test: the process that died, the delay measured between its appearance and the kill, and the directory that named it — or, after two minutes, that no such VMM appeared, so a watcher never outlives the run that asked for it. The watcher starts before the wake, so a boot of this lane that lasts some 0.4 s is caught whole and the delay runs from the VMM's appearance rather than from a round trip that would arrive after it. A VMM is one machine's boot process, an `_boot-vm <vm dir>/boot-config.json` of the runner's own binary, and that directory is the machine's own: the `name` file smolvm keeps in it holds the machine's name, which is how a watcher tells this machine's VMM from another agent's.
function watchForKill(id: string, afterMs: number): void {
  const out = `/tmp/boot-matrix-kill-${id}-${afterMs}`;
  onRunnerHost(
    id,
    [
      `out=${out}`,
      ": > $out",
      `cat > /tmp/boot-matrix-watch-${id}-${afterMs}.sh <<'WATCH'`,
      `out=${out}`,
      `now() { awk '{ printf "%d", $1 * 1000 }' /proc/uptime; }`,
      `dir=$(grep -lx '${id}' /var/lib/platform/disks/.cache/smolvm/vms/*/name 2>/dev/null | head -1)`,
      '[ -n "$dir" ] || { echo "no vm directory names ' +
        id +
        '" >> $out; exit 0; }',
      'needle=$(dirname "$dir")/',
      "pid=",
      "deadline=$(( $(now) + 120000 ))",
      'while [ -z "$pid" ]; do',
      "  for p in /proc/[0-9]*/cmdline; do",
      '    grep -qa -- "$needle" "$p" 2>/dev/null || continue',
      "    pid=${p#/proc/}; pid=${pid%/cmdline}",
      "    appeared=$(now)",
      "    break",
      "  done",
      '  [ -n "$pid" ] && break',
      '  [ "$(now)" -lt "$deadline" ] || { echo "no VMM in $needle appeared in 120s" >> $out; exit 0; }',
      "  sleep 0.02",
      "done",
      `sleep ${(afterMs / 1_000).toFixed(3)}`,
      'if kill -9 "$pid" 2>/dev/null; then',
      `  echo "killed $pid after $(( $(now) - appeared ))ms, from a wait of ${afterMs}ms, in $(basename "$(dirname "$dir")")" >> $out`,
      "else",
      '  echo "could not kill $pid: it had gone" >> $out',
      "fi",
      "WATCH",
      `nohup sh /tmp/boot-matrix-watch-${id}-${afterMs}.sh >/dev/null 2>&1 &`,
    ].join("\n"),
  );
}

// UNIT_BOUNDARY_DESCRIPTION: waits on the runner for the watcher's line and answers it, so the test reads a boot it was not quick enough to watch itself.
function killLine(id: string, afterMs: number): string {
  return onRunnerHost(
    id,
    [
      `out=/tmp/boot-matrix-kill-${id}-${afterMs}`,
      "i=0",
      'while [ ! -s "$out" ] && [ $i -lt 2400 ]; do',
      "  sleep 0.05",
      "  i=$((i + 1))",
      "done",
      'cat "$out" 2>/dev/null || true',
    ].join("\n"),
  ).trim();
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

// TEST_SCENARIO: a VMM that dies on the host — a kernel bug, a seccomp kill, an operator — takes the machine with it but must leave the disk as a boot can read it. The agent's machine is killed at four points of a boot: the moment its VMM appeared, then 0.1 s, 0.25 s and 0.4 s later, which spans a boot of this lane, some 0.4 s from the VMM's start to a guest that answers. After each, the agent must come back to running with the file in HOME unchanged: the runner restarts a guest that stopped answering, and platform-init seeds nothing over a home that is already on the disk.
test("comes back from its VMM being killed at points across a boot", async () => {
  test.setTimeout(1_200_000);
  for (const afterMs of KILL_DELAYS_MS) {
    await hibernate();
    watchForKill(agentId, afterMs);
    await api.agents.wake.mutate({ id: agentId });
    const out = killLine(agentId, afterMs);
    console.log(
      `[e2e] a wait of ${afterMs}ms from its VMM's appearance: ${out}`,
    );
    const killed = /killed (\d+) after (\d+)ms/.exec(out);
    expect(killed?.[0], `no VMM of ${agentId} was killed: ${out}`).toBeTruthy();
    expect(
      Number(killed?.[2]),
      `the VMM was killed ${killed?.[2]}ms after it appeared, before the ${afterMs}ms wait ran out: ${out}`,
    ).toBeGreaterThanOrEqual(afterMs);
    expect(
      Number(killed?.[2]),
      `the VMM was killed ${killed?.[2]}ms after it appeared, far past the ${afterMs}ms wait: ${out}`,
    ).toBeLessThan(afterMs + 500);
    await waitAgentState(api, agentId, "running", {
      timeoutMs: 600_000,
      failOnError: false,
    });
    await expectHomeFile(token, agentId, markerPath, marker, {
      timeoutMs: 120_000,
    });
  }
});

// TEST_SCENARIO: a disk with no block left costs a boot the empty work layer it needs before it mounts anything. platform-init gives back only what a boot discards — its scratch folders and the layers earlier boots set aside — and then boots with the home untouched, so the agent comes back without anyone having to free room from outside a machine that cannot boot. A machine's disk is a sparse file on its owner's claim, and the filler only marks blocks in the guest's own filesystem, so it takes almost nothing from the claim; a filesystem that allocates those blocks instead writes them onto the claim, which on this lane is the node's disk, so E2E_DISK_FILL_GIB is the most GiB the filler may mark, a cap below the disk's free space skips rather than leave a disk that is not full, and unset skips the case. The filler sits in /tmp, which a boot empties anyway.
test("boots a disk it found with no room left", async () => {
  test.setTimeout(900_000);
  const capGiB = Number(process.env.E2E_DISK_FILL_GIB ?? "");
  test.skip(
    !Number.isFinite(capGiB) || capGiB <= 0,
    "the filler marks blocks in the guest's filesystem, and a filesystem that allocates them instead writes them onto the claim, which on this lane is the node's disk; set E2E_DISK_FILL_GIB to the most GiB the fill may mark",
  );
  const fill = inGuest(
    agentId,
    [
      "echo before",
      "df -Pk /tmp | tail -1",
      'free=$(df -Pk /tmp | tail -1 | awk "{ print \$4 }")',
      `cap=$(( ${Math.round(capGiB)} * 1024 * 1024 ))`,
      'if [ "$free" -gt "$cap" ]; then',
      '  echo "cannot $free $cap"',
      "  exit 0",
      "fi",
      "i=0",
      "for step in 1048576 262144 65536 1024; do",
      '  while [ "$i" -lt 8192 ]; do',
      '    fallocate -l "${step}K" "/tmp/boot-matrix-fill.$i" || break',
      "    i=$((i+1))",
      "  done",
      "done",
      "sync",
      "echo after",
      "df -Pk /tmp | tail -1",
    ].join("\n"),
  );
  const refused = fill.split("\n").find((line) => line.startsWith("cannot "));
  test.skip(
    Boolean(refused),
    `the cap is below the disk's free space, so this run cannot fill it: ${refused}`,
  );
  const before = after(fill, "before");
  const left = after(fill, "after");
  console.log(`[e2e] the machine's disk before the fill: ${before}`);
  console.log(`[e2e] the machine's disk when the fill stopped: ${left}`);
  expect(
    capacityOf(left),
    `the disk was not filled: ${left}`,
  ).toBeGreaterThanOrEqual(99);

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

// TEST_SCENARIO: a disk with no journal can lose a file's bytes to an unclean stop and keep its name, so the layout mark can come back empty. platform-init counts an empty mark as no mark, writes it again and boots the home as it is, instead of refusing a disk it cannot place or, worse, reading it by the wrong names. The mark is emptied the way an operator inside the machine would: from a second mount of the disk, since the boot leaves the disk's root detached, and the boot after it must say in its log that it marked the disk.
test("boots on a disk whose layout mark came back empty", async () => {
  test.setTimeout(600_000);
  const emptied = inGuest(
    agentId,
    [
      "mkdir -p /mnt/boot-matrix-disk",
      "mount -t btrfs /dev/vda /mnt/boot-matrix-disk 2>&1",
      "echo mark",
      "cat /mnt/boot-matrix-disk/system/layout",
      "truncate -s 0 /mnt/boot-matrix-disk/system/layout",
      "sync",
      "echo emptied",
      "wc -c < /mnt/boot-matrix-disk/system/layout",
      "umount /mnt/boot-matrix-disk || true",
    ].join("\n"),
  );
  expect(
    after(emptied, "mark"),
    `the disk's layout mark was not there to empty: ${emptied}`,
  ).toBe("2");
  expect(
    after(emptied, "emptied"),
    `the mark did not read back empty: ${emptied}`,
  ).toBe("0");

  await hibernate();
  await api.agents.wake.mutate({ id: agentId });
  await waitAgentState(api, agentId, "running", {
    timeoutMs: 600_000,
    failOnError: false,
  });
  await expectHomeFile(token, agentId, markerPath, marker, {
    timeoutMs: 120_000,
  });
  const marked = inGuest(
    agentId,
    [
      "echo count",
      "grep -c 'marked the disk as layout 2' /var/log/platform/agent-runtime.log || true",
    ].join("\n"),
  );
  expect(
    Number(after(marked, "count")),
    `the boot did not mark the emptied disk: ${marked}`,
  ).toBeGreaterThan(0);
});

// TEST_SCENARIO: an owner's claim with no room left refuses a machine's start rather than letting its guest write into a disk the claim has no block for, and the owner is told which storage is full. The filler is this spec's own file on the claim, so it comes back off with one command once the refusal is seen, and the agent boots with HOME intact. The claim must have a filesystem of its own to be filled at all: the lane's local-path provisioner hands out a directory of the node's disk, so there the guard watches the node and a fill would fill the CI node, and E2E_CLAIM_FILL_GIB is how a run against an install whose claim is its own volume (a Ceph RBD, a loop device) opts in, with the most it may write onto the claim; unset, the case is skipped rather than run at the node's expense.
test("refuses a start while the owner's claim is full", async () => {
  test.setTimeout(600_000);
  const capGiB = Number(process.env.E2E_CLAIM_FILL_GIB ?? "");
  test.skip(
    !Number.isFinite(capGiB) || capGiB <= 0,
    "the lane's claim is a directory of the node's disk, so filling it would fill the node; set E2E_CLAIM_FILL_GIB against an install whose claim is its own volume",
  );
  onRunnerHost(agentId, "rm -f /var/lib/platform/disks/e2e-claim-fill");
  const filled = onRunnerHost(
    agentId,
    [
      "set -- $(df -Pk /var/lib/platform/disks | tail -1)",
      "used=$3",
      "avail=$4",
      "need=$(( ((used + avail) * 97 / 100) - used ))",
      `cap=$(( ${Math.round(capGiB)} * 1024 * 1024 ))`,
      'if [ "$need" -gt "$cap" ]; then',
      '  echo "cannot $need $cap"',
      "  exit 0",
      "fi",
      '[ "$need" -gt 0 ] || need=0',
      'fallocate -l "${need}K" /var/lib/platform/disks/e2e-claim-fill || dd if=/dev/zero of=/var/lib/platform/disks/e2e-claim-fill bs=1024 count="$need" 2>/dev/null || true',
      "sync",
      "echo filled",
      "df -Pk /var/lib/platform/disks | tail -1",
    ].join("\n"),
  );
  const [verdict = ""] = filled.trim().split("\n");
  test.skip(
    verdict.startsWith("cannot "),
    `the claim's filesystem is too big to fill under the cap: ${verdict}`,
  );
  try {
    const row = after(filled, "filled");
    console.log(`[e2e] the owner's claim when the fill stopped: ${row}`);
    expect(
      capacityOf(row),
      `the claim was not filled: ${row}`,
    ).toBeGreaterThanOrEqual(95);
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
    onRunnerHost(agentId, "rm -f /var/lib/platform/disks/e2e-claim-fill");
  }
  await api.agents.wake.mutate({ id: agentId });
  await waitAgentState(api, agentId, "running", {
    timeoutMs: 600_000,
    failOnError: false,
  });
  await expectHomeFile(token, agentId, markerPath, marker, {
    timeoutMs: 120_000,
  });
});
