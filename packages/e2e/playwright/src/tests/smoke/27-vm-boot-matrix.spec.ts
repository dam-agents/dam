// TEST_OVERVIEW: platform-init is a machine's PID 1 and the only holder of its agent's home, so a boot cut short must never cost the owner what is on the disk. This spec breaks a boot the ways a host failure does: it kills the machine's VMM once at each step of a boot that platform-init itself says it reached, and it kills a running guest whose writes are synced into HOME. It also empties the layout mark an unclean stop can leave empty. Each of them must end in one of two ways: the machine boots with the file in HOME readable, or it refuses to boot and says why. Two more cases need room the lane's node cannot spare, a disk with no block left and an owner's claim with none, so a run opts into them by environment, and the second needs a claim with a size of its own, which the lane's provisioner does not give it. Only the vm lane runs it, and the config runs it beside the other specs that boot their own agent.
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
  runnerClaimProvisioner,
  runnerKilledVmms,
  waitAgentState,
  writeHomeFile,
} from "../../lib/backend.js";
import { harnessName } from "../../lib/fixtures.js";

test.describe.configure({ mode: "serial" });

// UNIT_BOUNDARY_DESCRIPTION: the machine's own view of its disk, which is where platform-init writes: the disk as the guest sees it, and the home platform-init binds from it.
const disk = "/dev/vda";
const home = "/home/agent";
const diskAt = "/mnt/boot-matrix-disk";

const markerPath = "e2e-boot-matrix-marker.txt";
const syncedPath = "e2e-boot-matrix-synced.txt";
const claimFillPath = "/var/lib/platform/disks/e2e-claim-fill";

// UNIT_BOUNDARY_DESCRIPTION: the boot steps the matrix kills at, in the order a boot reaches them, each one a line platform-init writes to the machine's console: the disk mounted, the layout mark written, the platform's root laid over the image, and the agent's home mounted from the disk. A host reads the boot on that console and nowhere else, since the boot log is on the guest's disk, and each step's own writes follow its line. Only a boot that finds the disk unmarked writes the mark's line, so the kill there empties the mark first.
const KILLS = [
  {
    tag: "disk",
    lines: ["platform-init: storage disk mounted at"],
    clearsMark: false,
  },
  {
    tag: "mark",
    lines: ["platform-init: marked the disk as layout"],
    clearsMark: true,
  },
  {
    tag: "root",
    lines: [
      "platform-init: booting on a fresh root",
      "platform-init: keeping the root of the last boot",
    ],
    clearsMark: false,
  },
  {
    tag: "home",
    lines: ["platform-init: the home is on the disk at"],
    clearsMark: false,
  },
] as const;

let api: ApiClient;
const token = refreshingToken();
let agentId = "";
const marker = `home-survives-${randomUUID()}`;
const synced = `home-synced-${randomUUID()}`;
let claimFilled = false;

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

// UNIT_BOUNDARY_DESCRIPTION: empties the disk's layout mark from a second mount of the disk inside the guest, the way an operator would, and answers the mark it found. A boot on a disk with no mark writes one, which is the line the kill at that step waits for.
function emptyLayoutMark(): string {
  const emptied = inGuest(
    agentId,
    [
      `mkdir -p ${diskAt}`,
      `mount -t btrfs ${disk} ${diskAt} 2>&1`,
      "echo mark",
      `cat ${diskAt}/system/layout`,
      `truncate -s 0 ${diskAt}/system/layout`,
      "sync",
      "echo emptied",
      `wc -c < ${diskAt}/system/layout`,
      `umount ${diskAt} || true`,
    ].join("\n"),
    { timeoutMs: 60_000 },
  );
  expect(
    after(emptied, "mark"),
    `the disk's layout mark was not there to empty: ${emptied}`,
  ).toBe("2");
  expect(
    after(emptied, "emptied"),
    `the mark did not read back empty: ${emptied}`,
  ).toBe("0");
  return emptied;
}

// UNIT_BOUNDARY_DESCRIPTION: starts on the runner a watcher that waits for one of the given lines on this machine's console, finds the VMM that writes it, freezes that VMM, copies the console it had written by then, and SIGKILLs the frozen VMM: it writes one line for the test, the process that died and how long after the line it died, or why no kill came. With no line to wait for it kills at once, which is the case of a running guest. The console keeps the boot before until the next start empties it, and a VMM writes its first lines before the kernel's, so the watcher removes that record before it says it watches, and only then: the wake that follows cannot write the line before the removal, and a line read after it belongs to the boot this start makes. The VMM is the process whose command line names the boot config of the machine's directory, which the runtime passes to it and to nothing else, and no other: the helpers a start spawns name the disk, and a VMM of the boot before names the same config, so the watcher takes the one among them that runs now and, where a line was waited for, started after the watcher, whose own start the kernel records beside it. Freezing before the copy is what makes the copy evidence: the boot cannot reach the hand-off between the copy and the kill, and a VMM that went before it could be frozen is reported rather than killed. The lines reach a fixed-string grep in a shell script, so none of them may hold a single quote. The watcher gives up after a minute, so one that never fired does not outlive the case that asked for it.
function watchForKill(id: string, tag: string, lines: readonly string[]): void {
  const out = `/tmp/boot-matrix-kill-${tag}`;
  const script = `/tmp/boot-matrix-watch-${tag}.sh`;
  const ready = `/tmp/boot-matrix-watch-${tag}.ready`;
  onRunnerHost(
    id,
    [
      `out=${out}`,
      ": > $out",
      `rm -f ${ready}`,
      `cat > ${script} <<'WATCH'`,
      `out=${out}`,
      `now() { awk '{ printf "%d", $1 * 1000 }' /proc/uptime; }`,
      `dir=$(grep -lx '${id}' /var/lib/platform/disks/.cache/smolvm/vms/*/name 2>/dev/null | head -1)`,
      `[ -n "$dir" ] || { echo "no vm directory names this machine" >> $out; exit 0; }`,
      'vm=$(dirname "$dir")',
      "log=$vm/agent-startup-error.log",
      "deadline=$(( $(now) + 60000 ))",
      ...(lines.length === 0 ? [] : ['rm -f "$log"']),
      `: > ${ready}`,
      `mine=$(sed "s/.*) //" /proc/$$/stat | cut -d" " -f20)`,
      "find_pid() {",
      '  for c in $(grep -la -- "$vm/boot-config.json" /proc/[0-9]*/cmdline 2>/dev/null); do',
      "    p=${c#/proc/}; p=${p%/cmdline}",
      '    t=$(sed "s/.*) //" /proc/$p/stat 2>/dev/null | cut -d" " -f20)',
      `    [ ${lines.length === 0 ? "0" : "1"} = 1 ] && [ -n "$mine" ] && [ -n "$t" ] && [ "$t" -le "$mine" ] && continue`,
      '    echo "$p"',
      "    return 0",
      "  done",
      "  return 1",
      "}",
      ...(lines.length === 0
        ? []
        : [
            `while ! grep -qF ${lines.map((line) => `-e '${line}'`).join(" ")} -- "$log" 2>/dev/null; do`,
            '  [ "$(now)" -lt "$deadline" ] || { echo "no boot line of platform-init in a minute" >> $out; exit 0; }',
            "  sleep 0.01",
            "done",
          ]),
      "seen=$(now)",
      "pid=",
      'while [ -z "$pid" ]; do',
      "  pid=$(find_pid)",
      '  [ -n "$pid" ] && break',
      '  [ "$(now)" -lt "$deadline" ] || { echo "no VMM of this machine runs" >> $out; exit 0; }',
      "  sleep 0.01",
      "done",
      'kill -STOP "$pid" 2>/dev/null',
      'if ! kill -0 "$pid" 2>/dev/null; then',
      '  echo "the VMM went before it could be frozen: $pid" >> $out',
      "  exit 0",
      "fi",
      `cp "$log" /tmp/boot-matrix-console-${tag} 2>/dev/null`,
      'if kill -9 "$pid" 2>/dev/null; then',
      lines.length === 0
        ? '  echo "killed $pid at once in $(basename "$vm")" >> $out'
        : `  echo "killed $pid $(( $(now) - seen ))ms after '${lines[0]}' in $(basename "$vm")" >> $out`,
      "else",
      '  kill -CONT "$pid" 2>/dev/null',
      '  echo "could not kill $pid: it had gone" >> $out',
      "fi",
      "WATCH",
      `nohup sh ${script} >/dev/null 2>&1 & echo $! > /tmp/boot-matrix-watch-${tag}.pid`,
      `i=0; while [ ! -e ${ready} ] && [ $i -lt 200 ]; do sleep 0.05; i=$((i + 1)); done`,
    ].join("\n"),
    { timeoutMs: 60_000 },
  );
}

// UNIT_BOUNDARY_DESCRIPTION: waits on the runner for the watcher's line and answers it, so the test reads a kill it was not quick enough to watch itself. A watcher that has not fired by then is stopped, by the pid the run wrote and only while that pid still runs the watcher's own script, so the case that asked for it leaves nothing running on the runner.
function killReport(id: string, tag: string): string {
  return onRunnerHost(
    id,
    [
      `out=/tmp/boot-matrix-kill-${tag}`,
      "i=0",
      'while [ ! -s "$out" ] && [ $i -lt 1400 ]; do',
      "  sleep 0.05",
      "  i=$((i + 1))",
      "done",
      `pid=$(cat /tmp/boot-matrix-watch-${tag}.pid 2>/dev/null)`,
      `grep -qa 'boot-matrix-watch-${tag}' "/proc/$pid/cmdline" 2>/dev/null && kill "$pid" 2>/dev/null`,
      'cat "$out" 2>/dev/null || true',
    ].join("\n"),
    { timeoutMs: 120_000 },
  ).trim();
}

const SIGKILL = 9;
const HANDED_OFF = "handing off to the image entrypoint";

// UNIT_BOUNDARY_DESCRIPTION: the console of the boot a kill cut, as the watcher copied it just before the kill. The console is emptied at every start, so this is one boot: a step's line in it is a step the boot reached, and the hand-off to the image's entrypoint is the last thing platform-init does before the agent runs, so a copy without it is a boot the kill found still on its way there.
function cutBootConsole(id: string, tag: string): string {
  return onRunnerHost(
    id,
    `cat /tmp/boot-matrix-console-${tag} 2>/dev/null || true`,
    { timeoutMs: 30_000 },
  );
}

// UNIT_BOUNDARY_DESCRIPTION: the deaths the runner reported for this kill, waited for so the case reads them before it treats the recovery as the whole story, and answered empty when the runner reports none within a deadline. What it answers is what the runner said about this death and no other: a report that names the machine is this machine's, and one that names a pid is this death's only if the pid is the process the watcher killed.
async function killReports(
  id: string,
  before: number,
  killedPid: number,
  timeoutMs = 60_000,
): Promise<{ signal: number | null; pid: number | null }[]> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const reports = runnerKilledVmms(id)
      .slice(before)
      .filter((entry) => entry.pid === null || entry.pid === killedPid);
    if (reports.length > 0 || Date.now() > deadline) return reports;
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
}

// UNIT_BOUNDARY_DESCRIPTION: counts what this machine's console says of the boot it runs now. The console is the VMM's own log on the host, emptied at every start, so a line found there belongs to that boot and to no earlier one.
function consoleLines(id: string, needle: string): number {
  const count = onRunnerHost(
    id,
    [
      `dir=$(grep -lx '${id}' /var/lib/platform/disks/.cache/smolvm/vms/*/name 2>/dev/null | head -1)`,
      `grep -cF -- '${needle}' "$(dirname "$dir")/agent-startup-error.log" 2>/dev/null || true`,
    ].join("\n"),
    { timeoutMs: 60_000 },
  ).trim();
  return Number(count || "0");
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
  if (!agentId) return;
  try {
    if (claimFilled) {
      try {
        onRunnerHost(agentId, `rm -f ${claimFillPath}`, { timeoutMs: 60_000 });
      } catch {
        onRunnerHost(agentId, `rm -f ${claimFillPath}`, { timeoutMs: 60_000 });
      }
    }
  } finally {
    await api.agents.delete.mutate({ id: agentId });
    try {
      onRunnerHost(agentId, "rm -f /tmp/boot-matrix-*", { timeoutMs: 60_000 });
    } catch (error) {
      console.log(
        `[e2e] could not clear this spec's files off the runner: ${(error as Error).message}`,
      );
    }
  }
});

// TEST_SCENARIO: a VMM that dies on the host — a kernel bug, a seccomp kill, an operator — takes the machine with it but must leave the disk as a boot can read it. The machine is killed once at each step of a boot, from the line platform-init writes when it reaches that step, so every kill lands after that step began and before the boot is done, whatever the node's speed. Each kill must land inside the boot: the console the watcher copied while the VMM was frozen holds the step's line and no hand-off to the image's entrypoint. The runner must also report that kill, before the case treats the recovery as the whole story: a new report of a VMM of this machine dead, whose signal, where it names one, is the SIGKILL the watcher sent, and whose pid, where it names one, is the process the watcher killed — a death the runner reports without naming a machine is this death only when it names that pid. The runner sees a death inside its start call as that call's failure, one after it in the reaper's line or in its own stop of a machine that went away, and which of them a step of the boot lands on depends on the node's speed. After each, the agent must come back to running with the file in HOME unchanged: the runner restarts a guest that stopped answering, and a boot seeds nothing over a home that is already on the disk.
test("comes back from its VMM killed at points across a boot", async () => {
  test.setTimeout(1_200_000);
  for (const kill of KILLS) {
    if (kill.clearsMark) emptyLayoutMark();
    await hibernate();
    const before = runnerKilledVmms(agentId).length;
    watchForKill(agentId, kill.tag, kill.lines);
    await api.agents.wake.mutate({ id: agentId });
    const report = killReport(agentId, kill.tag);
    console.log(`[e2e] the kill at '${kill.lines[0]}': ${report}`);
    const killed = /^killed (\d+) /.exec(report);
    expect(
      killed?.[0],
      `no VMM of ${agentId} was killed at the boot step '${kill.lines[0]}': ${report}`,
    ).toBeTruthy();
    const killedPid = Number(killed?.[1]);
    const cut = cutBootConsole(agentId, kill.tag);
    expect(
      kill.lines.some((line) => cut.includes(line)),
      `the boot the watcher killed had not reached '${kill.lines[0]}': ${cut}`,
    ).toBe(true);
    expect(
      cut,
      `the boot the watcher killed had already handed off to the image's entrypoint: ${cut}`,
    ).not.toContain(HANDED_OFF);
    const reports = await killReports(agentId, before, killedPid);
    console.log(
      `[e2e] the runner's reports of the kill at '${kill.lines[0]}': ${JSON.stringify(reports)}`,
    );
    expect(
      reports.length,
      `the runner reported no death of the VMM killed at '${kill.lines[0]}': ${JSON.stringify(reports)}`,
    ).toBeGreaterThan(0);
    expect(
      reports.filter(
        (entry) => entry.signal !== null && entry.signal !== SIGKILL,
      ),
      `the runner reported a signal other than the SIGKILL the watcher sent at '${kill.lines[0]}': ${JSON.stringify(reports)}`,
    ).toEqual([]);
    await waitAgentState(api, agentId, "running", {
      timeoutMs: 600_000,
      failOnError: false,
    });
    await expectHomeFile(token, agentId, markerPath, marker, {
      timeoutMs: 120_000,
    });
  }
});

// TEST_SCENARIO: the commonest host failure takes a running VMM, with the writes the agent just synced into HOME at risk and nothing clean about the stop: the disk was never unmounted, so the next boot finds it as the kill left it. The platform must say the machine has gone, bring it back to running, and the file the guest synced must read back. The home must still take a write after that, which is the disk mounted read-write.
test("comes back with the writes a running guest synced", async () => {
  test.setTimeout(600_000);
  const wrote = inGuest(
    agentId,
    [
      `printf '%s' '${synced}' > ${home}/${syncedPath}`,
      "sync",
      "echo wrote",
      `cat ${home}/${syncedPath}`,
    ].join("\n"),
    { timeoutMs: 120_000 },
  );
  expect(after(wrote, "wrote"), `the write did not read back: ${wrote}`).toBe(
    synced,
  );
  watchForKill(agentId, "running", []);
  const report = killReport(agentId, "running");
  console.log(`[e2e] the kill of a running guest: ${report}`);
  expect(report, `no VMM of ${agentId} was killed: ${report}`).toMatch(
    /^killed \d+ /,
  );
  await expect
    .poll(async () => (await api.agents.get.query({ id: agentId })).state, {
      timeout: 120_000,
      intervals: [250, 500, 1_000],
      message: "the platform never reported that the machine had gone",
    })
    .not.toBe("running");
  await waitAgentState(api, agentId, "running", {
    timeoutMs: 600_000,
    failOnError: false,
  });
  await expectHomeFile(token, agentId, syncedPath, synced, {
    timeoutMs: 120_000,
  });
  const again = inGuest(
    agentId,
    [
      `printf '%s' 'after' > ${home}/${syncedPath}`,
      "sync",
      "echo wrote",
      `cat ${home}/${syncedPath}`,
    ].join("\n"),
    { timeoutMs: 120_000 },
  );
  expect(
    after(again, "wrote"),
    `the home took no write after the kill: ${again}`,
  ).toBe("after");
});

// TEST_SCENARIO: a disk with no room left costs a boot the folders it needs before it mounts anything, and platform-init answers that by deleting what a boot discards anyway — its scratch folders and the layers earlier boots set aside — and trying again. The fill marks blocks in the guest's own filesystem, so it takes almost nothing from the claim; its last pass writes many small files, because the folders the boot makes need the disk's metadata, which marking blocks leaves room in. A machine's disk is a sparse file on its owner's claim, and a filesystem that allocates those blocks instead writes them onto the claim, which on this lane is the node's disk, so E2E_DISK_FILL_GIB is the most GiB the filler may mark, a cap below the disk's free space skips rather than leave a disk that is not full, and unset skips the case.
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
      "j=0",
      'while [ "$j" -lt 200000 ]; do',
      '  : > "/tmp/boot-matrix-meta.$j" || break',
      "  j=$((j+1))",
      "done",
      "sync",
      "echo files",
      "echo $j",
      "echo after",
      "df -Pk /tmp | tail -1",
    ].join("\n"),
    { timeoutMs: 600_000 },
  );
  const refused = fill.split("\n").find((line) => line.startsWith("cannot "));
  test.skip(
    Boolean(refused),
    `the cap is below the disk's free space, so this run cannot fill it: ${refused}`,
  );
  const left = after(fill, "after");
  console.log(
    `[e2e] the machine's disk before the fill: ${after(fill, "before")}`,
  );
  console.log(
    `[e2e] the machine's disk when the fill stopped, after ${after(fill, "files")} more files: ${left}`,
  );
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
    consoleLines(agentId, "deleting what earlier boots left to delete"),
    "the boot did not free what earlier boots left behind and try again",
  ).toBeGreaterThan(0);
});

// TEST_SCENARIO: a disk with no journal can lose a file's bytes to an unclean stop and keep its name, so the layout mark can come back empty. platform-init counts an empty mark as no mark, writes it again and boots the home as it is, instead of refusing a disk it cannot place or, worse, reading it by the wrong names. The mark is emptied the way an operator inside the machine would: from a second mount of the disk, since the boot leaves the disk's root detached, and the boot after it must say in its log that it marked the disk.
test("boots on a disk whose layout mark came back empty", async () => {
  test.setTimeout(600_000);
  emptyLayoutMark();
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
    { timeoutMs: 120_000 },
  );
  expect(
    Number(after(marked, "count")),
    `the boot did not mark the emptied disk: ${marked}`,
  ).toBeGreaterThan(0);
});

// TEST_SCENARIO: an owner's claim with no room left refuses a machine's start rather than letting its guest write into a disk the claim has no block for, and the owner is told which storage is full. The filler is this spec's own file on the claim, so it comes back off with one command once the refusal is seen, and the agent boots with HOME intact; the file is removed again after the whole spec, retried there and never caught, so a case that timed out before its own removal cannot leave every later start of this owner refused, and a fill that cannot be removed fails the run rather than passing quietly. The claim must have a filesystem of its own to be filled at all: the lane's local-path provisioner hands out a directory of the node's disk, which this case refuses from the host side before writing anything, and E2E_CLAIM_FILL_GIB is how a run against an install whose claim is its own volume (a Ceph RBD, a loop device) opts in, with the most it may write onto the claim; unset, the case is skipped rather than run at the node's expense.
test("refuses a start while the owner's claim is full", async () => {
  test.setTimeout(600_000);
  const capGiB = Number(process.env.E2E_CLAIM_FILL_GIB ?? "");
  test.skip(
    !Number.isFinite(capGiB) || capGiB <= 0,
    "the lane's claim is a directory of the node's disk, so filling it would fill the node; set E2E_CLAIM_FILL_GIB against an install whose claim is its own volume",
  );
  const provisioner = runnerClaimProvisioner(agentId);
  test.skip(
    provisioner === "" || provisioner.includes("local-path"),
    `the owner's claim is a directory of the node's disk (its provisioner reads '${provisioner || "nothing"}'), so filling it would fill the node; set E2E_CLAIM_FILL_GIB against an install whose claim is its own volume`,
  );
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
      `fallocate -l "\${need}K" ${claimFillPath} || true`,
      "sync",
      "echo filled",
      "df -Pk /var/lib/platform/disks | tail -1",
    ].join("\n"),
    { timeoutMs: 180_000 },
  );
  const [verdict = ""] = filled.trim().split("\n");
  test.skip(
    verdict.startsWith("cannot "),
    `the claim's filesystem is too big to fill under the cap: ${verdict}`,
  );
  claimFilled = true;
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
  onRunnerHost(agentId, `rm -f ${claimFillPath}`, { timeoutMs: 60_000 });
  claimFilled = false;
  await api.agents.wake.mutate({ id: agentId });
  await waitAgentState(api, agentId, "running", {
    timeoutMs: 600_000,
    failOnError: false,
  });
  await expectHomeFile(token, agentId, markerPath, marker, {
    timeoutMs: 120_000,
  });
});
