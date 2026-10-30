// TEST_OVERVIEW: platform-init is a machine's PID 1 and the only holder of its agent's home, so a boot cut short must never cost the owner what is on the disk. This spec breaks a boot the ways a host failure does: it kills the machine's VMM once at each step of a boot that platform-init itself says it reached, and it kills a running guest whose writes are synced into HOME. It also empties the layout mark an unclean stop can leave empty. Each of them must end in one of two ways: the machine boots with the file in HOME readable, or it refuses to boot and says why. Two more cases need room the install's node cannot spare, a disk with no block left and an owner's claim with none, so a run opts into them by environment, and the second needs a claim with a size of its own, which the install's provisioner does not give it. The config runs it beside the other specs that boot their own agent.
import { expect, test } from "@playwright/test";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
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
  onRunnerHost,
  refreshingToken,
  claimOnNode,
  runnerClaimRead,
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
const claimDir = "/var/lib/platform/disks";
const claimFillPath = `${claimDir}/e2e-claim-fill`;
const claimFiller = "/tmp/boot-matrix-claim-fill";

// UNIT_BOUNDARY_DESCRIPTION: the four points of a boot the matrix kills at, in the order a boot reaches them, each one a line platform-init writes to the machine's console once that step is done: the disk mounted, the layout mark written, the platform's root laid over the image, and the agent's home mounted from the disk. A host reads the boot on that console and nowhere else, since the boot log is on the guest's disk. Each line marks the end of its step and not the start of the next, so a kill at one lands in the work that follows it — a mount's first writes, a home's seeding — and not inside the step the line names. Only a boot that finds the disk unmarked writes the mark's line, so the kill there empties the mark first.
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
const unprovenCuts: string[] = [];

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

// UNIT_BOUNDARY_DESCRIPTION: starts on the runner a watcher that waits for one of the given lines on this machine's console, finds the VMM that writes it, freezes that VMM, copies the console it had written by then, and SIGKILLs the frozen VMM: it writes one line for the test, the process that died and how long after the line it died, or why no kill came. With no line to wait for it kills at once, which is the case of a running guest. The console keeps the boot before until the next start empties it, and a VMM writes its first lines before the kernel's, so the watcher removes that record before it says it watches, and only then: the wake that follows cannot write the line before the removal, and a line read after it belongs to the boot this start makes. The VMM is the process whose command line names the boot config of the machine's directory, which the runtime passes to it and to nothing else, and no other: the helpers a start spawns name the disk, and a VMM of the boot before names the same config, so the watcher takes the one among them that runs now and, where a line was waited for, started after the watcher, whose own start the kernel records beside it. A start can spawn a VMM that goes before it is frozen, so the watcher takes the newest of them that still runs and looks again when the one it found has gone; one it never could freeze is reported rather than killed. The freeze is awaited: the watcher reads the state the kernel gives the process as stopped, and only then copies the console, so every thread of the VMM has stopped before the copy. What that leaves is the console's own delivery, which libkrun hands to the host from a thread of the same process, so the copy is the host's view at the freeze and not a claim about the guest: a line the guest wrote before the freeze may still be on its way, and the case reads the copy for the step it names and not as proof that no later step ran. The lines reach a fixed-string grep in a shell script, so none of them may hold a single quote. The watcher gives up after a minute, so one that never fired does not outlive the case that asked for it.
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
      "  best=",
      "  bestt=",
      '  for c in $(grep -la -- "$vm/boot-config.json" /proc/[0-9]*/cmdline 2>/dev/null); do',
      "    p=${c#/proc/}; p=${p%/cmdline}",
      '    t=$(sed "s/.*) //" /proc/$p/stat 2>/dev/null | cut -d" " -f20)',
      '    z=$(sed "s/.*) //" /proc/$p/stat 2>/dev/null | cut -d" " -f1)',
      '    [ -n "$t" ] && [ "$z" != Z ] || continue',
      `    [ ${lines.length === 0 ? "0" : "1"} = 1 ] && [ -n "$mine" ] && [ "$t" -le "$mine" ] && continue`,
      '    if [ -z "$bestt" ] || [ "$t" -gt "$bestt" ]; then best=$p; bestt=$t; fi',
      "  done",
      '  [ -n "$best" ] || return 1',
      '  echo "$best"',
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
      'frozen() { grep -qE "^State:[[:space:]]*T" /proc/$1/status 2>/dev/null; }',
      "pid=",
      "while :; do",
      "  pid=$(find_pid)",
      '  if [ -n "$pid" ]; then',
      '    kill -STOP "$pid" 2>/dev/null',
      "    i=0",
      '    while [ $i -lt 200 ] && ! frozen "$pid"; do',
      "      sleep 0.005",
      "      i=$((i + 1))",
      "    done",
      '    frozen "$pid" && break',
      "    pid=",
      "  fi",
      '  [ "$(now)" -lt "$deadline" ] || { echo "no VMM of this machine could be frozen" >> $out; exit 0; }',
      "  sleep 0.01",
      "done",
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
  await acceptTerms(api);
  agentId = await createAgentOn(api, "e2e-boot-matrix", harnessName, {
    neverIdle: true,
  });
  await waitAgentState(api, agentId, "running");
  await writeHomeFile(token, agentId, markerPath, marker);
  await expectHomeFile(token, agentId, markerPath, marker, {
    timeoutMs: 60_000,
  });
});

// UNIT_BOUNDARY_DESCRIPTION: how the filler group is found, in both the launch and the teardown: from the process group the kernel gave the filler, recorded by the filler itself before it writes anything, and from nothing else. `setsid` puts the filler in a session of its own, so its id is the id of every process the fill starts — `fallocate`, and whatever `fallocate` forks — and one signal ends them all, including a child forked after the signal was sent. The filler reads its own group id from the kernel's record of itself rather than the launcher assuming its own pid is that id, which holds whether or not `setsid` keeps the pid it was given. No process is identified by what its command line says, and that is what makes the teardown safe to run: it is invoked as `sh -c <this whole script>`, so its own command line holds every string this script contains, and any match on those would find and kill the teardown before it removed anything.
const FILLER_GROUP = [
  `set -- $(cat ${claimFiller}.pid 2>/dev/null)`,
  "lp=$1; p=$2; lt=$3",
].join("\n");

// UNIT_BOUNDARY_DESCRIPTION: what the filler writes when it is called for nothing but its fill: the allocation, a sync so the write is on the claim and not only in the page cache, and the marker the test waits on. It is a default and not the only body, because the teardown is also checked against a filler that forks a process of its own, which is the case a signal sent at the wrong target misses.
const DEFAULT_FILL = [
  `fallocate -l "$1"K ${claimFillPath} || true`,
  "sync",
  `: > ${claimFiller}.done`,
].join("\n");

// UNIT_BOUNDARY_DESCRIPTION: starts the filler, in a session of its own, and returns only once the filler has recorded the pid, group and start time it has in the kernel's record of it, because the teardown kills by that group and a call that timed out after the fork would otherwise leave a writer no group names. The record is a prerequisite of the allocation and not bookkeeping: the filler writes it first, reads it back, and exits before its body runs if what it wrote is not what it reads, so a fill that cannot be named is never written. It is written beside its final name and renamed into it, so a reader never sees half a record, and a record left by an earlier filler must be cleared before the fork, or the launch stops instead of letting a new writer hide under a stale name. The filler then stays alive as the group's leader until the teardown ends it, because a group whose leader is gone cannot be proved to be this filler's: the kernel may hand a freed group id to another session, and membership alone would then name a stranger. `setsid` is what gives the filler a group of its own; without it the filler would share the runner's group and signalling that group would kill the runner, so a launch with no `setsid` fails rather than falling back to a group that is not the filler's. The wait for the record is bounded, and a filler that refused to record fails the launch rather than leaving the teardown to find a writer it cannot name.
function launchFiller(sizeKiB: string, body = DEFAULT_FILL): string {
  return [
    `cat > ${claimFiller} <<'FILL'`,
    "#!/bin/sh",
    "sz=$1",
    `set -- $(sed 's/.*) //' /proc/$$/stat)`,
    `id="$$ \${3} \${20}"`,
    `{ echo "$id" > ${claimFiller}.pid.tmp && [ "$(cat ${claimFiller}.pid.tmp 2>/dev/null)" = "$id" ] && mv -f ${claimFiller}.pid.tmp ${claimFiller}.pid; } || { echo 'the filler could not record its identity, so it allocates nothing' >&2; exit 1; }`,
    `set -- "$sz"`,
    body,
    "exec sleep 86400",
    "FILL",
    `rm -rf ${claimFiller}.done ${claimFiller}.pid ${claimFiller}.pid.tmp`,
    `[ ! -e ${claimFiller}.pid ] || { echo 'the identity record of an earlier filler could not be cleared, so this launch allocates nothing' >&2; exit 1; }`,
    "command -v setsid >/dev/null || { echo 'no setsid: the filler cannot be given a group of its own' >&2; exit 1; }",
    `setsid sh ${claimFiller} ${sizeKiB} </dev/null >/dev/null 2>&1 &`,
    "i=0",
    `while [ $i -lt 200 ] && [ ! -s ${claimFiller}.pid ]; do sleep 0.05; i=$((i + 1)); done`,
    `[ -s ${claimFiller}.pid ] || { echo 'the filler recorded no identity, so no fill is known to be running' >&2; exit 1; }`,
  ].join("\n");
}

// UNIT_BOUNDARY_DESCRIPTION: the runner-side teardown of the claim fill: it ends every process the fill started, and only then removes the file, failing rather than reporting success when any of that did not happen. The group is read from what the filler recorded of itself, and its members are read from the kernel's own records, so nothing is matched by command line and the teardown cannot find itself. The filler's leader outlives every signal, and is what proves ownership: the recorded pid must still be in the recorded group and still be the process that started at the recorded time, and that is checked again before each pass, because a group id is released the moment its last member goes and can then be handed to another session. Only members other than the leader are signalled, one pid at a time, so the proof is still there to be checked after a signal. A leader that is gone, or that is no longer the process that started at the recorded time, refuses the whole teardown whatever the other members look like: an earlier pass proves nothing about a group after an interval, and nothing else here holds the identity across one. The leader is also the shell that runs the allocation, so it can start a writer at any moment, including between the last scan and the removal; it is therefore stopped before that scan, and the kernel's stopped state is what is waited for, since a stop that did not take would leave the race in place. Only then are the remaining members ended and the file removed. The leader is ended last, after the fill is gone and its removal read back, and while it holds the group id nothing can reuse it. The record is kept until the fill's removal has been read back, so a removal that failed leaves a later call able to name the writer, and so does the leader: it is still there to prove the group. A call that finds no record passes only when the fill and the script are gone too, so repeating a finished teardown is safe and an unrecorded writer is not accepted. Zombies are not members to wait for, since they cannot write and their reaping is their parent's. Running out of the wait is a failure, so a writer that never ends fails the run instead of passing quietly, and the caller's retry has a real failure to retry. The removal is read back, because `rm` alone is not evidence: a claim remounted read-only leaves the fill behind, and a shell that does not test `rm` would report success over it.
function stopFillerAndClear(): string {
  return [
    'fail() { echo "boot-matrix teardown: $*" >&2; exit 1; }',
    `if [ ! -e ${claimFiller}.pid ]; then`,
    `  [ ! -e ${claimFillPath} ] && [ ! -e ${claimFiller} ] && exit 0`,
    `  fail "no filler identity is on the runner, so the writer of ${claimFillPath} cannot be named and it is left as it is"`,
    "fi",
    FILLER_GROUP,
    '[ -n "$lp" ] && [ -n "$p" ] && [ -n "$lt" ] || fail "the recorded identity is incomplete: $(cat ' +
      claimFiller +
      '.pid 2>/dev/null)"',
    'case "$lp$p$lt" in *[!0-9]*) fail "the recorded identity is not three numbers: $lp $p $lt" ;; esac',
    '[ "$p" -gt 1 ] || fail "the recorded group $p is not a process group this filler could own"',
    "inGroup() {",
    '  [ -d "/proc/$1" ] || return 1',
    '  set -- $(sed "s/.*) //" "/proc/$1/stat" 2>/dev/null)',
    '  [ "$1" != "Z" ] && [ "$3" = "$p" ]',
    "}",
    "leader() {",
    '  [ -d "/proc/$lp" ] || return 1',
    '  set -- $(sed "s/.*) //" "/proc/$lp/stat" 2>/dev/null)',
    '  [ "$1" != "Z" ] && [ "$3" = "$p" ] && [ "${20}" = "$lt" ]',
    "}",
    "others() {",
    "  for c in /proc/[0-9]*; do",
    "    q=${c#/proc/}",
    '    [ "$q" != "$lp" ] && inGroup "$q" && echo "$q"',
    "  done",
    "}",
    "members() {",
    "  n=0",
    "  for c in /proc/[0-9]*; do",
    "    q=${c#/proc/}",
    '    inGroup "$q" && n=$((n + 1))',
    "  done",
    '  echo "$n"',
    "}",
    "unproved() {",
    '  fail "the group $p the launch recorded has no leader that is still this filler, so it is not proved to be this filler\'s and is left alone"',
    "}",
    "state() {",
    '  set -- $(sed "s/.*) //" "/proc/$lp/stat" 2>/dev/null)',
    '  echo "$1"',
    "}",
    "i=0",
    "while [ $i -lt 400 ]; do",
    "  leader || unproved",
    "  left=$(others)",
    '  [ -z "$left" ] && break',
    "  kill -9 $left 2>/dev/null",
    "  sleep 0.05",
    "  i=$((i + 1))",
    "done",
    "leader || unproved",
    'kill -STOP "$lp" 2>/dev/null',
    "i=0",
    'while [ $i -lt 200 ] && [ "$(state)" != "T" ]; do sleep 0.05; i=$((i + 1)); done',
    '[ "$(state)" = "T" ] || fail "the leader $lp of group $p could not be stopped, so a writer it starts from here would outlive the removal and the group could not be proved again; nothing is removed"',
    "i=0",
    "while [ $i -lt 200 ]; do",
    "  left=$(others)",
    '  [ -z "$left" ] && break',
    "  kill -9 $left 2>/dev/null",
    "  sleep 0.05",
    "  i=$((i + 1))",
    "done",
    '[ -z "$(others)" ] || fail "the filler group $p still has $(others | wc -l | tr -d " ") process(es) after the wait"',
    `rm -f ${claimFillPath} 2>/dev/null`,
    `[ ! -e ${claimFillPath} ] || fail "${claimFillPath} is still on the claim after its removal; the identity record and the group's leader are kept so that a later call can name the writer and prove the group again"`,
    "leader || unproved",
    'kill -9 "$lp" 2>/dev/null',
    "i=0",
    'while [ $i -lt 200 ] && [ "$(members)" -gt 0 ]; do sleep 0.05; i=$((i + 1)); done',
    '[ "$(members)" -eq 0 ] || fail "the group $p still has $(members) process(es) after its leader was ended, and no leader is left to prove it, so it is left alone"',
    `rm -f ${claimFiller} ${claimFiller}.pid ${claimFiller}.done ${claimFiller}.pid.tmp 2>/dev/null`,
    `[ ! -e ${claimFiller} ] || fail "${claimFiller} is still on the runner after its removal"`,
    `[ ! -e ${claimFiller}.pid ] || fail "${claimFiller}.pid is still on the runner after its removal"`,
    `df -Pk ${claimDir} | tail -1`,
  ].join("\n");
}

test.afterAll(async () => {
  if (!agentId) return;
  try {
    if (claimFilled) {
      try {
        onRunnerHost(agentId, stopFillerAndClear(), { timeoutMs: 60_000 });
      } catch {
        onRunnerHost(agentId, stopFillerAndClear(), { timeoutMs: 60_000 });
      }
    }
    try {
      onRunnerHost(agentId, "rm -f /tmp/boot-matrix-*", { timeoutMs: 60_000 });
    } catch (error) {
      console.log(
        `[e2e] could not clear this spec's files off the runner: ${(error as Error).message}`,
      );
    }
  } finally {
    await api.agents.delete.mutate({ id: agentId });
  }
});

// TEST_SCENARIO: a VMM that dies on the host — a kernel bug, a seccomp kill, an operator — takes the machine with it but must leave the disk as a boot can read it. The machine is killed once at each step of a boot, from the line platform-init writes when it reaches that step, so the kill is aimed at the work after that step whatever the node's speed. What this case proves is the recovery and the report: the agent must come back to running with the file in HOME unchanged, and the runner must report that death. It does not prove the kill landed before the boot handed off, and it does not claim to: the copy the watcher takes at the freeze holds the step's line, which proves the boot reached the step, but it holds no hand-off whether or not the guest had reached it, because libkrun writes the console from a thread of the same VMM that the freeze stops. A copy that does hold the hand-off is a kill that came too late, and that fails the case. A copy without it cannot separate an interrupted boot from one that had already handed off, so the cut is recorded as unproven, and the proof this case cannot give is stated as its own skipped requirement beside it. The runner must also report that kill, before the case treats the recovery as the whole story: a new report of a VMM of this machine dead, whose signal, where it names one, is the SIGKILL the watcher sent, and whose pid, where it names one, is the process the watcher killed — a death the runner reports without naming a machine is this death only when it names that pid. A report that names no signal is the runner noticing a machine it believed up had gone, which is not the cause and can be the runtime's own stop of a machine it could not grow, so a cut the runner never names a cause for is recorded in the run as the open requirement it is. The runner sees a death inside its start call as that call's failure, one after it in the reaper's line or in its own stop of a machine that went away, and which of them a step of the boot lands on depends on the node's speed. After each, the agent must come back to running with the file in HOME unchanged: the runner restarts a guest that stopped answering, and a boot seeds nothing over a home that is already on the disk.
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
    // UNIT_BOUNDARY_DESCRIPTION: what the console can and cannot say about when the kill landed, as a result and not only a note. The copy is the host's view at the freeze, taken from a thread of the VMM that libkrun fills before any line reaches the file, so a line the guest wrote before the freeze may still have been on its way: a copy without the hand-off is consistent with a boot that had handed off, so it is not evidence that the kill came first. The copy can prove one thing only, that the boot had put its step line on the host. So a copy that holds the hand-off is a boot the kill found too late, and it fails the case; and a copy without it leaves the cut unproven, which is not a pass either, so the case is marked so the run cannot read it as one. Both branches assert, which is what makes this a check rather than a note.
    expect(
      cut.includes(HANDED_OFF),
      `the kill at '${kill.lines[0]}' found a boot already handing off to the image's entrypoint, so it did not cut the boot: ${cut}`,
    ).toBe(false);
    if (!cut.includes(HANDED_OFF)) unprovenCuts.push(kill.tag);
    const reports = await killReports(agentId, before, killedPid);
    console.log(
      `[e2e] the runner's reports of the kill at '${kill.lines[0]}': ${JSON.stringify(reports)}`,
    );
    expect(
      reports.filter(
        (entry) => entry.signal !== null && entry.signal !== SIGKILL,
      ),
      `the runner reported a signal other than the SIGKILL the watcher sent at '${kill.lines[0]}': ${JSON.stringify(reports)}`,
    ).toEqual([]);
    const caused = reports.some((entry) => entry.signal === SIGKILL);
    if (!caused)
      test.info().annotations.push({
        type: "cause-unreported",
        description: `the runner named no signal for the kill at '${kill.lines[0]}' (${JSON.stringify(reports)}): an exit record is not a cause, and the requirement that the runtime report this cut's cause stays open rather than being read as met`,
      });
    await waitAgentState(api, agentId, "running", {
      timeoutMs: 600_000,
      failOnError: false,
    });
    await expectHomeFile(token, agentId, markerPath, marker, {
      timeoutMs: 120_000,
    });
  }
});

// TEST_SCENARIO: the requirement the case above cannot meet, written as a test of its own so no run reads its result as a pass. Proving that a kill landed inside a boot needs a boundary the guest itself acknowledges: the console cannot provide one, because libkrun delivers it from a thread of the VMM the freeze stops, so a line the guest wrote before the freeze may not have been written yet. Until the guest reports such a boundary, every cut whose console held no hand-off is named here and listed in the skip message, so the gap is visible in each run that had one, and no green result says the interruption path is proved.
test("proves each kill landed inside the boot", () => {
  test.skip(
    true,
    unprovenCuts.length === 0
      ? "no cut of this run needed this proof"
      : `the console cannot prove a kill landed before the boot handed off, so these cuts stay unproven and an acknowledged guest boundary is still missing: ${unprovenCuts.join(", ")}`,
  );
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

// TEST_SCENARIO: a disk with no room left costs a boot the folders it needs before it mounts anything, and platform-init answers that by deleting what a boot discards anyway — its scratch folders and the layers earlier boots set aside — and trying again. The fill marks blocks in the guest's own filesystem, so it takes almost nothing from the claim; its last pass writes many small files, because the folders the boot makes need the disk's metadata, which marking blocks leaves room in. A machine's disk is a sparse file on its owner's claim, and a filesystem that allocates those blocks instead writes them onto the claim, which on this install is the node's disk, so E2E_DISK_FILL_GIB is the most GiB the filler may mark, a cap below the disk's free space skips rather than leave a disk that is not full, and unset skips the case.
test("boots a disk it found with no room left", async () => {
  test.setTimeout(900_000);
  const capGiB = Number(process.env.E2E_DISK_FILL_GIB ?? "");
  test.skip(
    !Number.isFinite(capGiB) || capGiB <= 0,
    "the filler marks blocks in the guest's filesystem, and a filesystem that allocates them instead writes them onto the claim, which on this install is the node's disk; set E2E_DISK_FILL_GIB to the most GiB the fill may mark",
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

// TEST_SCENARIO: the launch and the teardown of the claim fill are run here, as the shell scripts they are, in a directory of this run's own and as `sh -c <script>` — the way the suite runs them on the runner. That is not the same as running the file: `sh -c` puts the whole script in the command line of the process doing the work, so a teardown that found its writers by matching text in a command line would match itself and kill the caller before it removed anything; that is the failure this check exists to keep out, and it only appears in this invocation. The cases are the ones a fill really produces: a fill that is still allocating when the teardown runs, an allocator that forked a process of its own that outlives the process that started it, a launch that died before it recorded anything, a fill that is already gone, a removal that failed and must be retried, and a group whose leader is gone or is no longer the process that was recorded. A teardown that is killed by a signal the shell reports as none is a failure here, since that is what a teardown matching its own command line does, and it removes nothing on its way down. The script itself is read as well: it must not signal the whole group, because that kills the leader and leaves nothing to prove the group's identity with, and it must check that identity before the signal that follows. Every case asserts the end state and not the wording: the group has no member left, the files are gone, a refused group is still there, and a launch that recorded nothing exits non-zero and says so.
test("launches the claim filler and takes it down as the runner would", () => {
  test.skip(
    spawnSync("sh", ["-c", "command -v setsid && [ -r /proc/self/stat ]"])
      .status !== 0,
    "this host has no setsid or no /proc, which the runner's teardown is built on",
  );
  const groups: string[] = [];
  const dir = mkdtempSync(join(tmpdir(), "boot-matrix-teardown-"));
  const filler = join(dir, "fill");
  const claimDirLocal = join(dir, "claim-dir");
  const claim = join(claimDirLocal, "claim");
  mkdirSync(claimDirLocal);
  writeFileSync(claim, "");
  const locally = (script: string) =>
    script.split(claimFiller).join(filler).split(claimFillPath).join(claim);
  const launch = (body: string) =>
    locally(launchFiller("1", body)).replace("$need", "1");
  const run = (script: string) =>
    spawnSync("sh", ["-c", script], { encoding: "utf8", timeout: 60_000 });
  const members = (group: string) =>
    spawnSync(
      "sh",
      [
        "-c",
        `n=0; for c in /proc/[0-9]*; do set -- $(sed "s/.*) //" "$c/stat" 2>/dev/null); [ "$1" != Z ] && [ "$3" = "${group}" ] && n=$((n + 1)); done; echo "$n"`,
      ],
      { encoding: "utf8" },
    ).stdout.trim();
  try {
    const started = run(launch([`sleep 60 &`, `sleep 61`].join("\n")));
    expect(started.status, `the launch failed: ${started.stderr}`).toBe(0);
    const group = readFileSync(`${filler}.pid`, "utf8").trim().split(" ")[1];
    groups.push(group);
    const taken = run(locally(stopFillerAndClear()));
    expect(
      taken.signal,
      "the teardown was killed, so it matched its own command line",
    ).toBe(null);
    expect(taken.stderr, "the teardown reported a failure").not.toContain(
      "boot-matrix teardown:",
    );
    expect(taken.status, `the teardown failed: ${taken.stderr}`).toBe(0);
    expect(existsSync(claim), "the fill is still there").toBe(false);
    expect(existsSync(`${filler}.pid`), "the record is still there").toBe(
      false,
    );
    expect(members(group), "a member of the filler's group survived").toBe("0");

    expect(
      run(locally(stopFillerAndClear())).status,
      "repeating a finished teardown was not safe",
    ).toBe(0);

    const gone = run(launch([`sleep 60 &`, `sleep 61`].join("\n")));
    expect(gone.status, `the launch failed: ${gone.stderr}`).toBe(0);
    groups.push(readFileSync(`${filler}.pid`, "utf8").trim().split(" ")[1]);
    rmSync(claim, { force: true });
    const quiet = run(locally(stopFillerAndClear()));
    expect(
      quiet.status,
      `a teardown over a fill that was already gone failed: ${quiet.stderr}`,
    ).toBe(0);

    const relaunched = run(launch([`sleep 60 &`, `sleep 61`].join("\n")));
    expect(relaunched.status, `the launch failed: ${relaunched.stderr}`).toBe(
      0,
    );
    groups.push(readFileSync(`${filler}.pid`, "utf8").trim().split(" ")[1]);
    // TEST_SCENARIO: a fill that `rm -f` cannot remove whoever runs it, root included, as the runner's teardown runs: a directory with content. A claim directory without write permission would block only a user that is not root.
    mkdirSync(claim);
    writeFileSync(join(claim, "content"), "content");
    const blocked = run(locally(stopFillerAndClear()));
    rmSync(claim, { recursive: true, force: true });
    writeFileSync(claim, "content");
    expect(
      blocked.status,
      "a fill that could not be removed reported success",
    ).not.toBe(0);
    expect(blocked.stderr).toContain("is still on the claim");
    expect(
      existsSync(`${filler}.pid`),
      "the identity record was removed before the fill, so a retry cannot name the writer",
    ).toBe(true);
    expect(
      run(locally(stopFillerAndClear())).status,
      "a retry after the claim became writable could not finish the removal",
    ).toBe(0);
    expect(existsSync(claim), "the retried teardown left the fill").toBe(false);

    // TEST_SCENARIO: a record that nobody can write, root included: its directory is a plain file, so nothing can be created under it.
    const recordDir = join(dir, "record-dir");
    writeFileSync(recordDir, "");
    const refused = run(
      locally(launch([`sleep 30`].join("\n")))
        .split(`${filler}.pid`)
        .join(join(recordDir, "identity")),
    );
    rmSync(recordDir, { force: true });
    expect(
      refused.status,
      "the launch passed although the filler could not record its identity",
    ).not.toBe(0);
    expect(refused.stderr).toContain("recorded no identity");
    expect(existsSync(claim), "the filler allocated without an identity").toBe(
      false,
    );

    rmSync(`${filler}.pid`, { force: true });
    writeFileSync(claim, "content");
    const orphaned = run(launch([`sleep 120 &`, `sleep 121`].join("\n")));
    expect(orphaned.status, `the launch failed: ${orphaned.stderr}`).toBe(0);
    const [orphanLeader, orphanGroup] = readFileSync(`${filler}.pid`, "utf8")
      .trim()
      .split(" ");
    groups.push(orphanGroup);
    spawnSync("sh", ["-c", `kill -9 ${orphanLeader}`]);
    const leaderGone = () => !existsSync(`/proc/${orphanLeader}`);
    for (let i = 0; i < 200 && !leaderGone(); i++) {
      spawnSync("sh", ["-c", "sleep 0.05"]);
    }
    expect(leaderGone(), "the leader of the filler did not go").toBe(true);
    expect(
      members(orphanGroup),
      "the group had no member left, so this case proves nothing",
    ).not.toBe("0");
    const stranger = run(locally(stopFillerAndClear()));
    expect(
      stranger.status,
      "a group whose leader is gone was signalled on membership alone",
    ).not.toBe(0);
    expect(stranger.stderr).toContain("not proved to be this filler");
    expect(
      members(orphanGroup),
      "the teardown killed a group it could not prove was the filler's",
    ).not.toBe("0");
    expect(
      existsSync(claim),
      "the fill was removed by a teardown it refused to run",
    ).toBe(true);
    const racer = run(
      launch(`while [ -e ${claim} ]; do :; done; echo late > ${claim}`),
    );
    expect(racer.status, `the racing launch failed: ${racer.stderr}`).toBe(0);
    const racerGroup = readFileSync(`${filler}.pid`, "utf8")
      .trim()
      .split(" ")[1];
    groups.push(racerGroup);
    const drained = run(locally(stopFillerAndClear()));
    expect(drained.status, `the teardown failed: ${drained.stderr}`).toBe(0);
    expect(
      existsSync(claim),
      "the filler wrote after the teardown removed the fill, so a writer outlived the removal",
    ).toBe(false);
    expect(
      members(racerGroup),
      "a process of the filler's group outlived the teardown",
    ).toBe("0");

    const script = locally(stopFillerAndClear());
    expect(
      script,
      "the teardown signals the whole group, which kills the leader and leaves nothing to check its identity against",
    ).not.toMatch(/kill\s+-[0-9A-Za-z]+\s+-/);
    expect(
      script,
      "the teardown signals without checking that group's leader first",
    ).toMatch(/leader \|\| unproved\n\s*left=\$\(others\)/);

    writeFileSync(claim, "content");
    const longest = run(launch([`sleep 300 &`, `sleep 301`].join("\n")));
    expect(longest.status, `the launch failed: ${longest.stderr}`).toBe(0);
    const [liveLeader, liveGroup, liveStart] = readFileSync(
      `${filler}.pid`,
      "utf8",
    )
      .trim()
      .split(" ");
    groups.push(liveGroup);
    writeFileSync(
      `${filler}.pid`,
      `${liveLeader} ${liveGroup} ${Number(liveStart) + 1}`,
    );
    const relabelled = run(locally(stopFillerAndClear()));
    expect(
      relabelled.status,
      "a group whose leader is still there but is not the one that was recorded was signalled anyway",
    ).not.toBe(0);
    expect(relabelled.stderr).toContain("not proved to be this filler");
    expect(
      members(liveGroup),
      "a group with a mismatched leader was signalled, so a reused one could be",
    ).not.toBe("0");
    expect(
      existsSync(claim),
      "the fill was removed by a teardown whose leader did not match",
    ).toBe(true);
  } finally {
    for (const group of groups) {
      spawnSync("sh", ["-c", `kill -9 -${group} 2>/dev/null`]);
    }
    rmSync(dir, { recursive: true, force: true });
  }
});

// TEST_SCENARIO: the read the claim-fill guard decides on is classified from its text alone, so the guard that stands between this suite and the node's own disk is checked without a cluster: a claim on the device of a node mount is refused, a claim on a device of its own is allowed, a filesystem that is not one — an overlay, a tmpfs — is refused as no proof, and a read that carries nothing usable is refused for the same reason. Evidence that is only half there is refused as well: one node mount read and the other not says nothing about which filesystem is the node's, and two node mounts that disagree cannot both be it, so neither is proof of a volume of its own. A guard that answered either way on a read it could not understand would either fill a node's disk or skip every install that has a volume of its own, which is the bug this check exists to keep out. The two counts this reads are not the same field: the device is the path's own inode (`stat -c %d`), while `stat -f -c %d` is the number of free inodes, which two directories on one filesystem need not share.
test("classifies the claim's filesystem against the node's own", () => {
  expect(claimOnNode("claim 66305 virtiofs\nnode 66305\nnode 66305")).toBe(
    true,
  );
  expect(claimOnNode("claim 1048704 ext4\nnode 66305\nnode 66305")).toBe(false);
  expect(claimOnNode("claim 40 overlay\nnode 66305\nnode 66305")).toBe(null);
  expect(claimOnNode("claim 40 tmpfs\nnode 66305\nnode 66305")).toBe(null);
  expect(claimOnNode("claim ext4\nnode 66305\nnode 66305")).toBe(null);
  expect(claimOnNode("claim 1048704 ext4\nnode 66305\nnode ")).toBe(null);
  expect(claimOnNode("claim 1048704 ext4\nnode \nnode 66305")).toBe(null);
  expect(claimOnNode("claim 1048704 ext4\nnode 66305")).toBe(null);
  expect(claimOnNode("claim 1048704 ext4\nnode 66305\nnode 66805")).toBe(null);
  expect(claimOnNode("")).toBe(null);
});

// TEST_SCENARIO: an owner's claim with no room left refuses a machine's start rather than letting its guest write into a disk the claim has no block for, and the owner is told which storage is full. The filler is this spec's own file on the claim, so it comes back off with one command once the refusal is seen, and the agent boots with HOME intact; the file is removed again after the whole spec, retried there and never caught, so a case that timed out before its own removal cannot leave every later start of this owner refused, and a fill that cannot be removed fails the run rather than passing quietly. The fill is armed before the call that can write it, so a call that fills the claim and then fails still has its file removed after the spec: the file is on the owner's storage, and deleting the Agent does not touch it. The claim must be proved to have storage of its own before anything is written, and the proof is read from inside the runner: the device the kernel gives the claim's path against the devices of the mounts the chart hands the runner from the node itself, and the claim's filesystem type. A claim on the device of a node mount is a directory of that node's disk, so it is refused; a filesystem that is not one, an overlay or a tmpfs, is no proof, and neither is a read where a node mount could not be read or two node mounts disagree, so those are refused too. Neither the provisioner's name nor the PersistentVolume's source is read, because neither says where a volume's blocks are. E2E_CLAIM_FILL_GIB is how a run against such an install opts in, with the most it may write onto the claim; unset, the case is skipped rather than run at the node's expense.
test("refuses a start while the owner's claim is full", async () => {
  test.setTimeout(600_000);
  const capGiB = Number(process.env.E2E_CLAIM_FILL_GIB ?? "");
  test.skip(
    !Number.isFinite(capGiB) || capGiB <= 0,
    "the install's claim is a directory of the node's disk, so filling it would fill the node; set E2E_CLAIM_FILL_GIB against an install whose claim is its own volume",
  );
  const read = runnerClaimRead(agentId);
  const onNode = claimOnNode(read);
  console.log(
    `[e2e] the runner's own filesystems, claim against node: ${read.trim()}`,
  );
  test.skip(
    onNode !== false,
    `the owner's claim is not proved to be a volume of its own (${onNode === null ? "its filesystem could not be read, or is not one of its own" : "it is on the device of a mount the node hands the runner"}), so filling it could fill the node; set E2E_CLAIM_FILL_GIB against an install whose claim is its own volume`,
  );
  claimFilled = true;
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
      launchFiller("$need"),
      "echo filling",
    ].join("\n"),
    { timeoutMs: 60_000 },
  );
  if (filled.trim() === "cannot" || filled.trim().startsWith("cannot ")) {
    claimFilled = false;
    test.skip(
      true,
      `the claim's filesystem is too big to fill under the cap: ${filled.trim()}`,
    );
  }
  const row = after(
    onRunnerHost(
      agentId,
      [
        "i=0",
        `while [ ! -e ${claimFiller}.done ] && [ $i -lt 2400 ]; do`,
        "  sleep 0.05",
        "  i=$((i + 1))",
        "done",
        `[ -e ${claimFiller}.done ] || { echo "still-allocating after the wait: $(cat ${claimFiller}.pid 2>/dev/null)"; exit 0; }`,
        `echo filled`,
        `df -Pk /var/lib/platform/disks | tail -1`,
      ].join("\n"),
      { timeoutMs: 180_000 },
    ),
    "filled",
  );
  expect(
    row,
    "the allocator never marked the fill finished within its wait, so the claim was not read after the fill stopped",
  ).not.toBe("");
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
  onRunnerHost(agentId, stopFillerAndClear(), { timeoutMs: 60_000 });
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
