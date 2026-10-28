// TEST_OVERVIEW: the room a vm agent frees goes back to its owner's storage, and what an agent writes stays inside the share the runner grants it. A machine's disk is a sparse file on the owner's claim, so a file the agent deletes keeps its blocks on the claim until the guest's filesystem discards them, and platform-init is what asks for that discard: the storage disk is mounted `discard=sync`, and it trims the whole disk every minute and before its storage guard preallocates, since a preallocated extent is allocated and no trim reaches it afterwards. The guard is a set of unnamed preallocated files that holds the guest to its share, and it gives room back by dropping whole files, because btrfs keeps the whole physical allocation of an extent a length alone partly released. Without both, the claim only ever grows and a writing agent wedges below the 95% ceiling: everything the owner is shown and refused for reads the claim. The spec boots two of the owner's machines because a share is the claim's room divided among the ones running, and it measures each machine's own disk file, the claim itself, and the guest's free space.
import { expect, test } from "@playwright/test";

import {
  type ApiClient,
  createRefreshingApiClient,
} from "../../lib/api-client.js";
import { deleteAgentIfPresent } from "../../lib/agents.js";
import { acceptTerms } from "../../lib/auth.js";
import {
  createAgentOn,
  inGuest,
  onRunnerHost,
  refreshingToken,
  runnerPod,
  waitAgentState,
} from "../../lib/backend.js";
import { harnessName } from "../../lib/fixtures.js";

const PROBE = "/home/agent/e2e-storage-trim-probe";
const SMALL = "/home/agent/e2e-storage-trim-small";
const PROBE_MIB = 300;
const SLACK_MIB = 60;
const MOVE_MIB = 32;
const WAIT_MS = 180_000;
// UNIT_BOUNDARY_DESCRIPTION: POOL_GUARD_FLOOR and POOL_GUARD_STEP in platform-init, the room every guest may write past its share, which the claim can pass the 95% ceiling by once per running machine, and the smallest move the guard makes.
const GUARD_FLOOR_MIB = 256;
const GUARD_STEP_MIB = 16;
const FILL_CHUNK_MIB = 256;
// UNIT_BOUNDARY_DESCRIPTION: the real bytes the always-on case writes and reads back: enough that the claim pays for them and their delete has to come back through a trim, and few enough that the case costs the host a fixed 256 MiB on any install.
const REAL_MIB = 256;
// UNIT_BOUNDARY_DESCRIPTION: the room the node keeps for itself while the claim is at its ceiling: the runner pod, its kubelet and the next case all write there, so a fill that leaves less has taken the host rather than the claim.
const HOST_HEADROOM_MIB = 1024;
// UNIT_BOUNDARY_DESCRIPTION: a runner look renews every grant every 30 s (STORAGE_CHECK) and the guard moves at most once per 30 s (POOL_GUARD_BACKOFF), so a refusal that recovers does so inside this window; a guest refused after it is the wedge.
const RENEWAL_MS = 75_000;
// UNIT_BOUNDARY_DESCRIPTION: the guest's own free space in KiB, and what it can still write after it has. The awk program is in shell single quotes: inside double quotes the shell would expand `$4` itself and awk would print the whole row.
const AVAIL_KB = `echo "avail=$(df -Pk /home/agent | tail -1 | awk '{ print $4 }')"`;
const ROOM_KB = `room=$(df -Pk /home/agent | tail -1 | awk '{ print $4 }')`;
// UNIT_BOUNDARY_DESCRIPTION: how long the ceiling case may spend reaching the refusal: filling a budget of many GiB, and waiting out the runner's 30 s grant look and the guard's 30 s backoff after every refusal the guest recovers from.
const CEILING_MS = 600_000;

test.describe.configure({ mode: "serial" });

let api: ApiClient;
const token = refreshingToken();
let probeId = "";
let siblingId = "";
let probeDisk = "";

// UNIT_BOUNDARY_DESCRIPTION: how many siblings the share-move case can start: two rounds of up to three attempts, each starting at most two. Each has a name of its own, so a retried attempt never waits on the delete of the sibling it replaces to free a name, and setup clears every one of them from an earlier run.
const MOVE_PEERS = 12;

// UNIT_BOUNDARY_DESCRIPTION: what each machine's disk file takes on the owner's claim, in MiB, by the directory it sits in. A disk is sparse, so this is the room the machine has written and not the size it is sized at, and it is what the claim pays for that machine.
function machineDisks(): Map<string, number> {
  const table = onRunnerHost(
    probeId,
    'for f in "$HOME"/.cache/smolvm/vms/*/storage.raw; do echo "$(basename "$(dirname "$f")") $(stat -c %b "$f")"; done',
  );
  return new Map(
    table
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const [dir, blocks] = line.split(" ");
        return [dir, Math.round((Number(blocks) * 512) / 1048576)] as const;
      }),
  );
}

// UNIT_BOUNDARY_DESCRIPTION: the claim as the runner reads it, in KiB, from the runner pod whose `$HOME` is the owner's claim: what the claim holds, and what it holds plus what it can still take, which is the claim's own capacity. The filesystem's total is no ceiling for the claim, since that filesystem's other users hold room the claim never had.
function claimKb(): { used: number; capacity: number } {
  const fields = onRunnerHost(probeId, 'df -Pk "$HOME" | tail -1').split(/\s+/);
  const [used, avail] = [Number(fields[2]), Number(fields[3])];
  return { used, capacity: used + avail };
}

// UNIT_BOUNDARY_DESCRIPTION: the grant the runner published to the probe's machine and the guest's own free space, read in one guest command with the grant bracketing the room: the grant line, the guest's `df`, and the grant line again. They are only comparable as one look — the runner writes a new grant every 30 s and a grant compared with a room read a look apart reads short for no defect — so a sample whose two grant lines differ straddles a renewal and is reported as unstable for the caller to retry, at no cost but one more read. The grant figure is not a share this spec works out for itself, because what the guard must do is hold the guest to the grant it was given. The id is what tells a renewal from the grant of an earlier look, and it is a figure the runner published, not an acknowledgement that the guard has processed that grant: the guard's own look and its 30 s move backoff are the runner's host side, so a bound is waited for rather than read once. An absent file prints `-`, never an empty line: `inGuest` trims its output, so an empty line would vanish, the `df` line would take the grant's place, and its first field would read as a grant id and its fourth as the grant. A `-` parses as no grant at all, so an unmeasured claim reads as NaN and fails the caller's check instead of passing a figure the guest never had.
function readRoom(id: string = probeId): {
  id: string;
  grantMiB: number;
  availMiB: number;
  diskMiB: number;
  stable: boolean;
} {
  const [before, avail, after] = inGuest(
    id,
    [
      'grant() { printf "%s\\n" "$(cat /platform/storage-room 2>/dev/null || echo -)"; }',
      "grant",
      "df -Pk /home/agent | tail -1",
      "grant",
    ].join("\n"),
  ).split("\n");
  const [beforeId = "", bytes = ""] = (before ?? "").trim().split(/\s+/);
  const [afterId = ""] = (after ?? "").trim().split(/\s+/);
  const mib = Number(bytes) / 1048576;
  const df = (avail ?? "").split(/\s+/);
  return {
    id: beforeId,
    grantMiB: bytes && Number.isFinite(mib) ? Math.round(mib) : Number.NaN,
    availMiB: Math.round(Number(df[3] ?? Number.NaN) / 1024),
    diskMiB: Math.round(Number(df[1] ?? Number.NaN) / 1024),
    stable: beforeId === afterId,
  };
}

// UNIT_BOUNDARY_DESCRIPTION: what the probe's own disk can still give its guest, in MiB: the disk's size less what the guest holds on it, which is the blocks it wrote — what its disk file took on the claim — and the room a case marked, which takes nothing on the claim. A guard can hold a guest back and never give it more than its disk, and the disk is sized at the owner's pool while the runner grants from the claim's own filesystem, which on an install whose claim is a directory of the node's disk holds far more than the pool. So a renewed grant can pass the disk once the guest has marked a grant's worth of it — on the CI lane a 40 GiB disk, a 22 GiB grant and a fill of 22 GiB left the guest 17.8 GiB, every block its disk had (#6043) — and the room a guard owes the guest is the grant or this, whichever is less. A disk file that still holds blocks the guest freed and its trim has not yet returned reads the guest as holding more, which only lowers the bound.
function diskLeftMiB(markedMiB: number): number {
  return (
    readRoom().diskMiB - (machineDisks().get(probeDisk) ?? 0) - markedMiB
  );
}

// UNIT_BOUNDARY_DESCRIPTION: the bounds a settled room meets, as one pair: no less than the grant, or the room its disk has left when that is less (diskLeftMiB), and no more than the grant plus the one floor every guest keeps. The slack is what the case's own measurements and the guard's step can account for.
function heldToShare(
  leftMiB: number,
): (room: { grantMiB: number; availMiB: number }) => boolean {
  return (room) =>
    room.availMiB >=
      Math.min(room.grantMiB, leftMiB) - SLACK_MIB - GUARD_STEP_MIB &&
    room.availMiB <= room.grantMiB + GUARD_FLOOR_MIB + SLACK_MIB;
}

// UNIT_BOUNDARY_DESCRIPTION: waits for a sample the guard has settled on and returns it: a grant published after `after`, the id the case saw once its own write had landed, and one whose guest room meets both of the caller's bounds at once. Three things make that a settled sample rather than a passing figure. The id differs from `after`, so the renewal the runner publishes over the case's own writes is exercised and not skipped when the room happens to read well. The bounds are one pair, both applied to the same sample, so a room the guard has not yet shrunk cannot pass as a healthy one, and a room it has not yet grown cannot fail as a wedged one. And the two grant lines around the room agree, so the free space belongs to one grant version. The window is `WAIT_MS`, well past the runner's 30 s look and the guard's 30 s backoff; a claim with no grant is no claim measured and fails at once rather than looping on a figure no bound can satisfy.
async function settledRoom(
  after: string,
  fits: (room: { grantMiB: number; availMiB: number }) => boolean,
  what: string,
): Promise<{ grantMiB: number; availMiB: number }> {
  const deadline = Date.now() + WAIT_MS;
  for (;;) {
    await keepAwake(probeId);
    const room = readRoom();
    if (room.stable) {
      expect(
        Number.isFinite(room.grantMiB),
        `${what}: the runner published no grant after ${after || "none"} for the probe's claim, so the guest's room cannot be compared with it`,
      ).toBe(true);
      if (room.id !== after && fits(room)) return room;
    }
    expect(
      Date.now(),
      `${what}: the guest reads ${room.availMiB} MiB of the ${room.grantMiB} MiB grant the runner published, under the grant ${room.id || "the case started with"}`,
    ).toBeLessThan(deadline);
    await new Promise((resolve) => setTimeout(resolve, 5_000));
  }
}

// UNIT_BOUNDARY_DESCRIPTION: wakes a machine and waits for it to run before a case reads it. The idle sweep stops a machine whose harness reports idle for the chart's vmIdleTimeout, 5 minutes, and a per-agent hibernation timeout a spec can set is not what the sweep reads for a machine; a case's own work is guest-side and invisible to the sweep's probe, so each phase wakes its machines first and is bounded well inside that window.
async function keepAwake(id: string): Promise<void> {
  await api.agents.wake.mutate({ id });
  await waitAgentState(api, id, "running");
}

// UNIT_BOUNDARY_DESCRIPTION: the room the probe's guest can still write, in MiB: its share, less what it wrote, once the guard holds the rest.
function guestAvailMiB(): number {
  const line = inGuest(probeId, "df -Pk /home/agent | tail -1");
  return Math.round(Number(line.split(/\s+/)[3]) / 1024);
}

// UNIT_BOUNDARY_DESCRIPTION: the guest marks its whole remaining room in one file, so a case reaches its share in one call whatever the pool is, and falls back to chunks when the filesystem refuses an allocation it cannot reserve whole: btrfs answers that to a request for the full free space, and a case that read the room figure alone would report the guard as broken when the fill never ran. The chunks go a size at a time and only get smaller, so the room left is under the smallest of them: an allocation is all or nothing, so a refused 256 MiB says nothing about a 64 MiB one, and stopping at the first refusal would leave the guest room the request after it is then allowed to take. The output is returned whole, so a caller reads the room the guest has left from the same command that filled it.
function markRoom(id: string, dir: string): string {
  return inGuest(
    id,
    [
      `dir=${dir}`,
      ROOM_KB,
      'if fallocate -l "$(( room / 1024 ))M" "$dir/full" 2>"$dir/full.err"; then echo "fill=whole"; else',
      'echo "fill=chunked"',
      "for size in 256 128 64 32 16 8; do",
      "n=0",
      'while [ "$n" -lt 4096 ] && fallocate -l "${size}M" "$dir/part-${size}-$n" 2>/dev/null; do n=$((n+1)); done',
      "done",
      "fi",
      "sync",
      AVAIL_KB,
    ].join("\n"),
  );
}

// UNIT_BOUNDARY_DESCRIPTION: the test user's running machines other than the case's own, as one comparable key. A share is the claim's room divided among every running machine, so one of these starting or stopping moves the probe's share as much as the case's own sibling does. Specs of other projects run beside this one and own them — the idle sweep hibernates one after 5 minutes, and a spec can wake or start one at any time — so the case reads them and does not touch them (#5624).
async function otherMachines(): Promise<string> {
  return (await api.agents.list.query())
    .filter(
      (agent) =>
        agent.id !== probeId &&
        agent.id !== siblingId &&
        agent.state === "running",
    )
    .map((agent) => agent.id)
    .sort()
    .join(" ");
}

async function waitFor(
  read: () => number,
  fits: (value: number) => boolean,
  what: string,
): Promise<number> {
  const deadline = Date.now() + WAIT_MS;
  for (;;) {
    const value = read();
    if (fits(value)) return value;
    expect(Date.now(), `${what}: it reads ${value} MiB`).toBeLessThan(deadline);
    await new Promise((resolve) => setTimeout(resolve, 5_000));
  }
}

test.beforeAll(async () => {
  test.setTimeout(900_000);
  api = createRefreshingApiClient(token);
  await acceptTerms(api);
  for (const name of [
    "e2e-storage-trim",
    "e2e-storage-trim-peer",
    "e2e-storage-trim-peer-1",
    "e2e-storage-trim-peer-2",
    ...Array.from(
      { length: MOVE_PEERS },
      (_, n) => `e2e-storage-trim-move-${n + 1}`,
    ),
  ])
    await deleteAgentIfPresent(api, name);
  probeId = await createAgentOn(api, "e2e-storage-trim", harnessName);
  siblingId = await createAgentOn(api, "e2e-storage-trim-peer", harnessName);
  await waitAgentState(api, probeId, "running");
  await waitAgentState(api, siblingId, "running");
});

test.afterAll(async () => {
  for (const id of [probeId, siblingId]) {
    if (id) await api.agents.delete.mutate({ id }).catch(() => undefined);
  }
});

// TEST_SCENARIO: an agent writes 300 MiB of random bytes, which compression cannot shrink, and deletes them. Its own disk must take them and give them back after the delete, which only the guest's trim returns to the claim; no other machine's disk may move, since a claim figure that falls because a sibling freed room says nothing about this one. A claim that keeps the room is room no message the owner is shown can free, since only deleting a whole agent frees a disk.
test("room a vm agent frees goes back to its owner's claim", async () => {
  test.setTimeout(900_000);
  test.skip(
    !runnerPod(probeId),
    "the Mac's host runner runs outside the cluster",
  );
  await keepAwake(probeId);
  const before = machineDisks();
  const growth = () =>
    [...machineDisks()].map(
      ([dir, mib]) => [dir, mib - (before.get(dir) ?? 0)] as const,
    );
  inGuest(probeId, `head -c ${PROBE_MIB}M /dev/urandom > ${PROBE} && sync`);
  await waitFor(
    () => Math.max(...growth().map(([, delta]) => delta)),
    (delta) => delta >= PROBE_MIB - SLACK_MIB,
    "no machine's disk took the probe",
  );
  const grown = growth().sort(([, a], [, b]) => b - a);
  probeDisk = grown[0][0];
  expect(
    grown[0][1],
    "the probe's own disk must take the probe",
  ).toBeGreaterThanOrEqual(PROBE_MIB - SLACK_MIB);
  expect(
    Math.max(...grown.slice(1).map(([, delta]) => delta)),
    "no other machine's disk may take the probe",
  ).toBeLessThan(MOVE_MIB);
  await keepAwake(probeId);
  inGuest(probeId, `rm -f ${PROBE} && sync`);
  await waitFor(
    () => machineDisks().get(probeDisk) ?? 0,
    (mib) => mib <= (before.get(probeDisk) ?? 0) + SLACK_MIB,
    "the deleted probe never left the claim",
  );
});

// TEST_SCENARIO: the trim asks for every free range, not only the large ones. A home of many small files frees its room in ranges below the 1 MiB minimum the trim once required, and a filesystem's minimum filters each range rather than their total, so a cleaned-up home of 600 files of 512 KiB kept its room on the owner's claim while the larger delete of the case before it gave its room back.
test("room a home of small files frees goes back too", async () => {
  test.setTimeout(900_000);
  test.skip(!probeDisk, "an earlier case did not measure a machine's disk");
  await keepAwake(probeId);
  const before = machineDisks().get(probeDisk) ?? 0;
  inGuest(
    probeId,
    [
      `mkdir -p ${SMALL}`,
      `cd ${SMALL} && for i in $(seq 1 600); do head -c 512K /dev/urandom > "$i"; done; sync`,
    ].join("\n"),
  );
  await waitFor(
    () => (machineDisks().get(probeDisk) ?? 0) - before,
    (mib) => mib >= PROBE_MIB - SLACK_MIB,
    "the probe's small files never reached its disk",
  );
  await keepAwake(probeId);
  inGuest(probeId, `rm -rf ${SMALL} && sync`);
  await waitFor(
    () => machineDisks().get(probeDisk) ?? 0,
    (mib) => mib <= before + SLACK_MIB,
    "the deleted small files never left the claim",
  );
});

// TEST_SCENARIO: a share is the claim's room below its 95% ceiling divided among the machines that are running, so stopping a sibling doubles the probe's share and starting one halves it again, and the guard must take both moves and give the room back both ways: stopping the sibling grows the share, which shrinks the guard, and the guest's free space must rise; starting another grows the guard back, and the free space must fall. Two cycles, because a resize that frees only part of a preallocated extent loses a little room on every move, and the loss adds up. The user's other running machines belong to specs that run beside this one, and one of them that stops or starts during a round cancels the move the round waits for, so a round that fails while they changed is run again, up to three times; a round that fails while they held still fails the case. The claim's own use is not asserted here: every round boots a machine, and a boot writes onto the claim, so what the claim gains is the new machine's own room.
test("the guard gives a machine the room its share gains, and takes it back", async () => {
  test.setTimeout(1_800_000);
  test.skip(!probeDisk, "an earlier case did not measure a machine's disk");
  await keepAwake(probeId);
  await keepAwake(siblingId);
  const probeDiskBefore = machineDisks().get(probeDisk) ?? 0;
  let movePeers = 0;
  for (const round of [1, 2]) {
    for (let attempt = 1; ; attempt++) {
      const others = await otherMachines();
      try {
        if (!siblingId) {
          siblingId = await createAgentOn(
            api,
            `e2e-storage-trim-move-${++movePeers}`,
            harnessName,
          );
          await waitAgentState(api, siblingId, "running");
        }
        await keepAwake(probeId);
        const base = guestAvailMiB();
        await api.agents.delete.mutate({ id: siblingId });
        siblingId = "";
        await keepAwake(probeId);
        const stopped = await waitFor(
          guestAvailMiB,
          (mib) => mib >= base + MOVE_MIB,
          `round ${round}: the guest's free space did not grow when a machine stopped`,
        );
        siblingId = await createAgentOn(
          api,
          `e2e-storage-trim-move-${++movePeers}`,
          harnessName,
        );
        await waitAgentState(api, siblingId, "running");
        await keepAwake(probeId);
        await waitFor(
          guestAvailMiB,
          (mib) => mib <= stopped - MOVE_MIB,
          `round ${round}: the guest's free space did not fall when another machine started`,
        );
        break;
      } catch (error) {
        if (attempt >= 3 || (await otherMachines()) === others) throw error;
      }
    }
  }
  expect(
    Math.abs((machineDisks().get(probeDisk) ?? 0) - probeDiskBefore),
    "the guard's moves must leave the probe's own disk where it was, since its blocks are marked in the guest's filesystem and never written onto the claim",
  ).toBeLessThanOrEqual(2 * MOVE_MIB);
});

// TEST_SCENARIO: a guest the guard holds at its share is not wedged there: the renewal that follows gives it its share back, it writes real bytes of it, and it writes again once a machine stops and its share grows. This is the defect a user reports — a steadily writing agent that hits "no space left on device" at three quarters of the storage and stays stuck — and it needs no room on the claim to reproduce: the guest's whole remaining room is filled without writing bytes, so the guest's own filesystem counts it as used and the claim does not pay for it, and the case costs a disk of the size the install already gives it and works on any pool. Each comparison waits for one sample that meets both of its bounds, and the renewed one needs a grant the runner published after the case's own write, so a room the guard has not finished moving is neither accepted as healthy nor rejected as wedged. The refusal itself is the case after this one, which asks for more than any grant could give the guest so that no renewal can make its write fit.
test("a writing agent stops at its share, and writes again when its share grows", async () => {
  test.setTimeout(900_000);
  test.skip(!probeDisk, "an earlier case did not measure a machine's disk");
  await keepAwake(probeId);
  await keepAwake(siblingId);
  const diskBefore = machineDisks().get(probeDisk) ?? 0;
  inGuest(probeId, "mkdir -p /tmp/e2e-fill");
  try {
    // UNIT_BOUNDARY_DESCRIPTION: real bytes through a renewal, always: the guest writes 256 MiB of random bytes into its home, the claim pays for them, and the case records the grant id it saw once those bytes had landed. Then they are deleted and the claim must take them back. This is the small bounded half of the case that fills the claim: it costs the host a fixed 256 MiB rather than a whole install, it grows the claim as only written blocks can, and a guard that leaked what it released would take the guest below its floor here before the marking below ever runs.
    inGuest(
      probeId,
      `head -c ${REAL_MIB}M /dev/urandom > /tmp/e2e-fill/real && sync`,
    );
    const paid = (machineDisks().get(probeDisk) ?? 0) - diskBefore;
    expect(
      paid,
      `the guest wrote ${REAL_MIB} MiB of real bytes and its disk took ${paid} MiB of the claim`,
    ).toBeGreaterThanOrEqual(REAL_MIB - SLACK_MIB);
    // UNIT_BOUNDARY_DESCRIPTION: the baseline the renewed comparison is measured from is the grant the guest holds now that its own 256 MiB have landed: a grant id read before the write could be republished during it, and a renewal that happened mid-write would then count as the post-write one without the guard ever having seen the whole write. The comparison below therefore requires an id past this one, which is a renewal the runner published over all of them.
    const written = readRoom();
    expect(
      Number.isFinite(written.grantMiB),
      "the runner published no grant for the probe's claim, so the guest's room cannot be compared with it",
    ).toBe(true);
    // UNIT_BOUNDARY_DESCRIPTION: and neither below nor above the renewed grant: the guest may still write the whole grant the runner published over its own writes, and no more than that grant plus the one floor every guest keeps. A guest held to a fraction of its grant is the defect a user reports — an agent refused at three quarters of its storage with the claim a third empty — and a guard that released its whole hold, or moved before the runner could renew, would leave the guest the disk instead. Both bounds are one sample's, waited for together: a room the guard has not finished shrinking yet must not pass the upper bound, and a room it has not finished growing yet must not fail the lower one. The slack is what the case's own measurements and the guard's step can account for, and a guest that never reaches either bound fails inside the same window a wedged one would.
    const writtenLeft = diskLeftMiB(0);
    const afterWrite = await settledRoom(
      written.id,
      heldToShare(writtenLeft),
      `the guest's room never came to the grant the runner published over its own writes, with ${writtenLeft} MiB left on its disk`,
    );
    // UNIT_BOUNDARY_DESCRIPTION: the wedge this case is for is a guest that stops writing and stays stopped, so the renewal is answered with a real write of its own, synced and read back: a machine that keeps the answer to a shortage after the claim has room again fails here, and no arithmetic about its free space can stand in for that.
    expect(
      inGuest(
        probeId,
        "head -c 8M /dev/urandom > /tmp/e2e-fill/renewed && sync && wc -c < /tmp/e2e-fill/renewed",
      ).trim(),
      `a renewal window after writing ${REAL_MIB} MiB the guest could write ${afterWrite.availMiB} MiB but not 8 MiB`,
    ).toBe(String(8 * 1024 * 1024));
    await keepAwake(probeId);
    inGuest(probeId, "rm -f /tmp/e2e-fill/real /tmp/e2e-fill/renewed && sync");
    await waitFor(
      () => machineDisks().get(probeDisk) ?? 0,
      (mib) => mib <= diskBefore + SLACK_MIB,
      "the real bytes the guest deleted across a renewal never left the claim",
    );
    // UNIT_BOUNDARY_DESCRIPTION: the guest's room after the fill, which is a share-size comparison and not the refusal: a guest the guard holds at its share has no room of a floor plus slack left, and every check below this line depends on the fill standing.
    const marking = markRoom(probeId, "/tmp/e2e-fill");
    const availMiB = Math.round(
      Number(/avail=(\d+)/.exec(marking)?.[1]) / 1024,
    );
    expect(
      Number.isFinite(availMiB),
      `the guest did not report its free space: ${marking}`,
    ).toBe(true);
    expect(
      availMiB,
      `the guest still had ${availMiB} MiB after marking its own room, and the fill reported ${marking}`,
    ).toBeLessThanOrEqual(GUARD_FLOOR_MIB + SLACK_MIB);
    // UNIT_BOUNDARY_DESCRIPTION: the refusal itself is the case after this one, which marks this fill again and asks for a write past any grant the guest could be given, rather than for the few MiB an agent's next write needs: a renewed allowance can return room between a fill and the write, and nothing here tells that renewal from a write wrongly allowed.
    // UNIT_BOUNDARY_DESCRIPTION: the fill only marks blocks, so the claim must not have paid for it: a disk that grew by the fill is the guard handing the guest room the guest never wrote.
    const afterFill = machineDisks().get(probeDisk) ?? 0;
    expect(
      afterFill - diskBefore,
      `a marked fill took ${afterFill - diskBefore} MiB of the probe's disk on the claim`,
    ).toBeLessThanOrEqual(SLACK_MIB);
    // UNIT_BOUNDARY_DESCRIPTION: a renewal window later the guest is back on its share, and that is the design rather than a leak: the runner writes a new grant at every look, and the guard counts one from what the guest had written when it came, so a fill the claim never paid for — which the assertion just above checks it did not — is room the guest is given again. The bound is therefore the renewed grant the runner published, not the floor: below it the agent has been left less than its share (the defect a user reports, a refusal at three quarters of the claim with the claim a third empty), and above it by more than one floor the guard released more than the grant it was told to hold. The grant the refused guest held at its refusal is the baseline, so the sample must be a renewal published past it and not the grant the fill ran into.
    const marked = readRoom();
    expect(
      Number.isFinite(marked.grantMiB),
      "the runner published no grant for the probe's claim at its refusal, so the renewal cannot be measured from one",
    ).toBe(true);
    // UNIT_BOUNDARY_DESCRIPTION: the fill holds the room it marked on the guest's disk, so what the disk has left for a renewal is read with it: `du` counts the blocks a preallocated file holds, and the fill is the only thing in its directory once the real bytes are gone.
    const markedMiB = Math.round(
      Number(inGuest(probeId, "du -sk /tmp/e2e-fill | cut -f1").trim()) / 1024,
    );
    const markedLeft = diskLeftMiB(markedMiB);
    await new Promise((resolve) => setTimeout(resolve, RENEWAL_MS));
    const resettled = await settledRoom(
      marked.id,
      heldToShare(markedLeft),
      `the guest never got its share back after marking ${markedMiB} MiB of its own room, with ${markedLeft} MiB left on its disk, which no renewal gave it either: an agent that cannot write its share is the wedge this case is for`,
    );
    // UNIT_BOUNDARY_DESCRIPTION: the room the renewal gave back is room a real write lands in: a machine that kept the answer to its last refusal, however much room the claim gave it, fails here, and no arithmetic about its free space can stand in for the write. No refusal is asked of the guest here, deliberately: the renewal gave it its share back, so it is meant to write, and whether btrfs also allocates the few MiB past its own `df` estimate — its reserve, not the guard — is no property of this fix.
    expect(
      inGuest(
        probeId,
        "head -c 32M /dev/urandom > /tmp/e2e-fill/back-in && sync && wc -c < /tmp/e2e-fill/back-in",
      ).trim(),
      `an agent refused at its share must write again once a renewal gives the room back, and it reported ${resettled.availMiB} MiB`,
    ).toBe(String(32 * 1024 * 1024));
    // UNIT_BOUNDARY_DESCRIPTION: the refused guest's refusal must be its share and not the claim: another agent of the owner writes real bytes beside it, syncs them, and finds them again, and the claim is still within its own capacity.
    expect(
      inGuest(
        siblingId,
        "head -c 8M /dev/urandom > /tmp/e2e-still-writes && sync && wc -c < /tmp/e2e-still-writes",
      ).trim(),
      "the claim must stay writable for the owner's other agents",
    ).toBe(String(8 * 1024 * 1024));
    const claim = claimKb();
    expect(
      claim.used,
      `a concurrent writer took the claim to ${claim.used} KiB of its ${claim.capacity}`,
    ).toBeLessThanOrEqual(claim.capacity);
    // UNIT_BOUNDARY_DESCRIPTION: a policy check on the live claim that costs the host no byte, not the claim-ceiling regression: the runner grants each machine's guest its even part of what is left below 95% of the claim's capacity, so no single guest may be granted the whole of that room. The claim's room is read before the grants, and use only grows, so every grant published after that read is a part of a room no larger than the figure used here: a runner that granted one guest the room the claim has, which is how a guest writes into the claim's last blocks, reads above it and fails. Three limits are stated rather than papered over. There is no sum over the observed grants, because a grant read here may predate the claim read or a sibling's renewal, so a sum fails a healthy runner; the cost is that two machines each granted the whole room pass, which only the near-ceiling refusal below can catch. A sum also could not prove the ceiling, since a runner counting machines this case does not observe could grant past 95% overall. And a runner that granted nothing at all would satisfy an upper bound alone, so each grant must also be a positive part. The near-ceiling regression — a guest refused while the claim itself is at 94–95% — needs the claim filled and stays in the `E2E_DISK_FILL_GIB` case below, and it stays open until a run can fill a small claim without a host budget.
    const roomMiB = Math.max(
      0,
      Math.round((0.95 * claim.capacity - claim.used) / 1024),
    );
    const grants = [probeId, siblingId]
      .filter(Boolean)
      .map((id) => readRoom(id));
    for (const [machine, grant] of grants.entries()) {
      expect(
        Number.isFinite(grant.grantMiB),
        `the runner published no grant for machine ${machine + 1} of the owner's, so the ceiling cannot be read`,
      ).toBe(true);
      expect(
        grant.grantMiB,
        `machine ${machine + 1} of the owner's was granted ${grant.grantMiB} MiB of the ${roomMiB} MiB left below the claim's 95% ceiling, and one guest may only be granted a part of that room`,
      ).toBeLessThanOrEqual(roomMiB);
      expect(
        grant.grantMiB,
        `machine ${machine + 1} of the owner's was granted ${grant.grantMiB} MiB of the ${roomMiB} MiB left below the claim's ceiling: a running machine with room on the claim is granted a part of it, not nothing`,
      ).toBeGreaterThan(0);
    }
    // UNIT_BOUNDARY_DESCRIPTION: the agent refused at its share must write again once its share grows, which a wedged one does not: it keeps the answer to its last refusal however much room the owner frees. Its share grows when a sibling stops, and the room has to be room a real write lands in. A guest its disk holds rather than its grant (diskLeftMiB) has no room a larger share can add, so the room it must reach is its share's growth or what its disk has left, whichever is less, and the write after it is what shows it writes again either way.
    const beforeRenew = guestAvailMiB();
    const renewLeft = diskLeftMiB(markedMiB);
    await api.agents.delete.mutate({ id: siblingId });
    siblingId = "";
    await waitFor(
      guestAvailMiB,
      (mib) =>
        mib >=
        Math.min(
          beforeRenew + MOVE_MIB,
          renewLeft - SLACK_MIB - GUARD_STEP_MIB,
        ),
      `the refused guest never got its room back when a machine stopped, with ${renewLeft} MiB left on its disk`,
    );
    expect(
      inGuest(
        probeId,
        "head -c 64M /dev/urandom > /tmp/e2e-fill/after-renew && sync && wc -c < /tmp/e2e-fill/after-renew",
      ).trim(),
      "an agent refused at its share must write again once its share grows",
    ).toBe(String(64 * 1024 * 1024));
  } finally {
    // UNIT_BOUNDARY_DESCRIPTION: a failure leaves the fill on the machine, where it holds the guest at its share for a later case, so the room goes back whatever ends the case, and a cleanup that fails on its own may not replace the case's own result: `inGuest` throws before a promise exists, so each call runs inside one.
    await keepAwake(probeId).catch(() => undefined);
    await Promise.resolve()
      .then(() => inGuest(probeId, "rm -rf /tmp/e2e-fill"))
      .catch(() => undefined);
  }
});

// TEST_SCENARIO: a guest the guard holds at its share is refused its next write, and refused for want of space rather than another reason: that write is what a steadily writing agent makes next, and the wedge a user reports is an agent refused it while its share has room. The check is coarser than that wedge: it does not judge the write at the size of the guest's own grant, because a renewal can return room between the fill and the write and no guest-side figure says which allowance the guard has applied. So the fill marks the guest's whole remaining room, and the write then asks for more than any grant the guest could be given in the meantime — everything the claim has left below its 95% ceiling, which no grant exceeds even with one machine up, plus the floor every guest may write past its grant, the guard's step and this case's slack — so no room a renewal lands before the write can make it fit, and the guest being far over rather than at its share is what makes the refusal a refusal. A guest let past that bound is the defect, so the write is made once and never retried until it is refused.
test("a guest held at its share is refused its next write", async () => {
  test.setTimeout(900_000);
  test.skip(!probeDisk, "an earlier case did not measure a machine's disk");
  await keepAwake(probeId);
  // UNIT_BOUNDARY_DESCRIPTION: the claim's own figures, read before the fill so the bound is the largest one any grant could be: the runner grants a running machine an even part of what is left below 95% of the claim's capacity, and the claim's use only grows, so no grant published from here on exceeds this room however often it is renewed. The write adds the floor a guest may write past its grant, the guard's step beyond it and the slack the case's measurements carry, so the bound holds even if the guard is a whole move and a whole floor from where the case thinks it is.
  const claim = claimKb();
  const probeMiB =
    Math.max(0, Math.round((0.95 * claim.capacity - claim.used) / 1024)) +
    GUARD_FLOOR_MIB +
    GUARD_STEP_MIB +
    SLACK_MIB;
  inGuest(probeId, "mkdir -p /tmp/e2e-refusal");
  try {
    markRoom(probeId, "/tmp/e2e-refusal");
    const refused = inGuest(
      probeId,
      `if fallocate -l ${probeMiB}M /tmp/e2e-refusal/probe-$(date +%s%N) 2>/tmp/e2e-refusal/probe.err; then echo "probe=marked"; else echo "probe=refused"; cat /tmp/e2e-refusal/probe.err 2>/dev/null; fi`,
    );
    expect(
      refused,
      `the guest was not refused a write of ${probeMiB} MiB, which is past the whole room the claim has left below its ceiling and the floor a guest may write past its grant: ${refused}`,
    ).toMatch(/probe=refused/);
    expect(
      refused,
      "the guest must be refused for want of space, not for another reason",
    ).toMatch(/No space left on device/);
  } finally {
    await keepAwake(probeId).catch(() => undefined);
    await Promise.resolve()
      .then(() => inGuest(probeId, "rm -rf /tmp/e2e-refusal"))
      .catch(() => undefined);
  }
});

// TEST_SCENARIO: the claim figure a user sees, which needs the claim itself filled: a guest refused at its share must have reached the ceiling the runner holds the claim to, and not been refused at three quarters of it with the claim a third empty. This writes real bytes, since only written blocks count against the claim, so the fill costs the host the room it takes; its budget is reserved before the first byte — the room below the claim's ceiling plus the one floor a refused guest may still write — and a claim whose budget is larger than `E2E_DISK_FILL_GIB` allows skips the case with that figure rather than filling the host. A budget that was enough and still left the guest writing fails the case: that is a refusal the fix never produced, not a reason to skip. A refusal counts only once it survives a renewal window, and the peer writes beside the probe throughout, because a claim at its ceiling refuses new machines and a peer started after the fill could never boot.
test("a refused agent has filled the claim to its ceiling", async () => {
  test.setTimeout(1_200_000);
  test.skip(!probeDisk, "an earlier case did not measure a machine's disk");
  const capMiB = Math.floor(Number(process.env.E2E_DISK_FILL_GIB ?? "") * 1024);
  await keepAwake(probeId);
  const claim = claimKb();
  const needMiB = Math.ceil((0.95 * claim.capacity - claim.used) / 1024);
  // UNIT_BOUNDARY_DESCRIPTION: the budget is reserved before the first byte, and it holds more than the fill is expected to need: the room below the claim's ceiling, the one floor a guest refused at its share may still write, the slack a measured fill allows — `du` counts in blocks, and the guard may leave a guest one POOL_GUARD_STEP beyond its grant — and a whole chunk more, so a fill that lands exactly on the estimate still has a real write left to be refused with. A budget that runs out with writes still landing is the refusal this case never produced, and it fails rather than skips. `du` counts the blocks the guest holds, so a write refused part way still counts what it kept.
  const budgetMiB = needMiB + GUARD_FLOOR_MIB + SLACK_MIB + FILL_CHUNK_MIB;
  test.skip(
    !Number.isFinite(capMiB) || capMiB <= 0 || budgetMiB > capMiB,
    `filling this claim to its ceiling reserves ${budgetMiB} MiB of real bytes on the host, and E2E_DISK_FILL_GIB allows ${Number.isFinite(capMiB) ? capMiB : 0} MiB`,
  );
  // UNIT_BOUNDARY_DESCRIPTION: the sibling is made and woken before the fill, not after it: a claim at its ceiling starts no machine, so a peer created once the claim is full would never reach running and the case would fail on its own setup.
  if (!siblingId)
    siblingId = await createAgentOn(
      api,
      "e2e-storage-trim-peer-2",
      harnessName,
    );
  await keepAwake(siblingId);
  inGuest(probeId, "mkdir -p /tmp/e2e-claim-fill");
  const writtenMiB = () =>
    Math.round(
      Number(
        inGuest(
          probeId,
          "du -sk /tmp/e2e-claim-fill 2>/dev/null | cut -f1",
        ).trim() || 0,
      ) / 1024,
    );
  // UNIT_BOUNDARY_DESCRIPTION: one real write of `chunkMiB` into a file of its own, with `dd`'s error read from its status and its own file: a redirect that sends the error into the data loses it exactly when the disk is full.
  const fill = (chunkMiB: number, chunk: number) =>
    inGuest(
      probeId,
      [
        `if dd if=/dev/urandom bs=1M count=${chunkMiB} of=/tmp/e2e-claim-fill/chunk-${chunk} 2>/tmp/e2e-claim-fill/dd.err; then echo "dd=wrote"; else echo "dd=refused"; cat /tmp/e2e-claim-fill/dd.err 2>/dev/null; fi`,
        "sync",
        AVAIL_KB,
      ].join("\n"),
    );
  try {
    // UNIT_BOUNDARY_DESCRIPTION: the budget is spent a chunk at a time, and the last chunk is whatever is left of it: a request capped at the reservation keeps every byte inside it, and the measured slack and the whole chunk after the fill leave room for the renewed refusal. A refusal with nothing left to write is not the wedge by itself: the runner republishes every grant on its 30 s look and the guard may move once per 30 s backoff, so the case waits that window out, writes again, and counts the refusal stable only when the write after the window is refused too. Both machines are woken every round, since the sweep stops one whose harness reports idle for 5 minutes and a fill of several GiB outlasts that.
    const deadline = Date.now() + CEILING_MS;
    let availMiB = Number.POSITIVE_INFINITY;
    let refusalsInARow = 0;
    let spentMiB = 0;
    for (
      let chunk = 0;
      Date.now() < deadline && refusalsInARow < 2;
      chunk += 1
    ) {
      await keepAwake(probeId);
      await keepAwake(siblingId);
      spentMiB = writtenMiB();
      const leftMiB = budgetMiB - spentMiB;
      expect(
        leftMiB,
        `the fill wrote all ${budgetMiB} MiB it reserved, slack and the chunk past the fill included, and the guest could still write ${availMiB} MiB: the claim holds ${claimKb().used} KiB of its ${claimKb().capacity}, so a guest is writing past the ceiling the runner holds it to`,
      ).toBeGreaterThan(0);
      const out = await fill(Math.min(FILL_CHUNK_MIB, leftMiB), chunk);
      availMiB = Math.round(Number(/avail=(\d+)/.exec(out)?.[1]) / 1024);
      expect(
        Number.isFinite(availMiB),
        `the guest did not report its free space: ${out}`,
      ).toBe(true);
      if (!/dd=refused/.test(out)) {
        refusalsInARow = 0;
        continue;
      }
      expect(
        out,
        "the guest must be refused for want of space, not for another reason",
      ).toMatch(/No space left on device/);
      if (availMiB > GUARD_FLOOR_MIB + SLACK_MIB) {
        refusalsInARow = 0;
        continue;
      }
      refusalsInARow += 1;
      if (refusalsInARow < 2)
        await new Promise((resolve) => setTimeout(resolve, RENEWAL_MS));
    }
    expect(
      refusalsInARow,
      `the fill wrote ${spentMiB} MiB of a budget of ${budgetMiB} MiB and the guest was still writing ${availMiB} MiB after a renewal window: the claim holds ${claimKb().used} KiB of its ${claimKb().capacity}, so this is not the ceiling`,
    ).toBeGreaterThanOrEqual(2);
    // UNIT_BOUNDARY_DESCRIPTION: btrfs counts an allocation in the free space statvfs reports only at its next commit, so the ceiling is waited for rather than read once.
    const use = await waitFor(
      () => claimKb().used,
      (kb) => kb >= Math.round(0.94 * claim.capacity),
      `the claim never reached the 94% a guest refused after ${writtenMiB()} MiB must have reached`,
    );
    const after = claimKb();
    expect(
      use,
      `the claim holds ${use} KiB of its ${after.capacity}, past the 95% ceiling`,
    ).toBeLessThanOrEqual(
      Math.round(0.95 * after.capacity) + GUARD_FLOOR_MIB * 1024,
    );
    // UNIT_BOUNDARY_DESCRIPTION: durable room for the owner's other agents at the ceiling: the peer that was running throughout writes real bytes, syncs them, and reads them back.
    expect(
      inGuest(
        siblingId,
        "head -c 8M /dev/urandom > /tmp/e2e-ceiling-write && sync && wc -c < /tmp/e2e-ceiling-write",
      ).trim(),
      "the claim at its ceiling must still take the owner's other agents' writes",
    ).toBe(String(8 * 1024 * 1024));
    // UNIT_BOUNDARY_DESCRIPTION: a claim at its ceiling is the guests' room, not the host's: the node keeps a floor of its own or the runner, its kubelet and the next case have nowhere to write.
    const host = onRunnerHost(probeId, 'df -Pk "$HOME" | tail -1').split(/\s+/);
    expect(
      Number(host[3]),
      `a claim filled to its ceiling left the host ${host[3]} KiB`,
    ).toBeGreaterThanOrEqual(HOST_HEADROOM_MIB * 1024);
    expect(
      writtenMiB(),
      `the fill wrote ${writtenMiB()} MiB, more than the ${budgetMiB} MiB it reserved`,
    ).toBeLessThanOrEqual(budgetMiB + SLACK_MIB);
  } finally {
    // UNIT_BOUNDARY_DESCRIPTION: the room goes back whatever ends the case, and a cleanup that fails on its own may not replace the case's own result: `inGuest` throws before a promise exists, so each call runs inside one, and the wait for the fill to leave the claim is a check of the fix, not of the cleanup, and is left to the case that asserts it.
    await keepAwake(probeId).catch(() => undefined);
    await Promise.resolve()
      .then(() => inGuest(probeId, "rm -rf /tmp/e2e-claim-fill"))
      .catch(() => undefined);
  }
});
