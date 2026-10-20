// TEST_OVERVIEW: the room a vm agent frees goes back to its owner's storage, and what an agent writes stays inside the share the runner grants it. A machine's disk is a sparse file on the owner's claim, so a file the agent deletes keeps its blocks on the claim until the guest's filesystem discards them, and platform-init is what asks for that discard: the storage disk is mounted `discard=sync`, and it trims the whole disk every minute and before its storage guard preallocates, since a preallocated extent is allocated and no trim reaches it afterwards. The guard is a set of unnamed preallocated files that holds the guest to its share, and it gives room back by dropping whole files, because btrfs keeps the whole physical allocation of an extent a length alone partly released. Without both, the claim only ever grows and a writing agent wedges below the 95% ceiling: everything the owner is shown and refused for reads the claim. Only the vm lane runs this spec, it boots two of the owner's machines because a share is the claim's room divided among the ones running, and it measures each machine's own disk file, the claim itself, and the guest's free space.
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
  requireBackend,
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
// UNIT_BOUNDARY_DESCRIPTION: POOL_GUARD_FLOOR in platform-init, the room every guest may write past its share, which the claim can pass the 95% ceiling by once per running machine.
const GUARD_FLOOR_MIB = 256;
const FILL_CHUNK_MIB = 256;
// UNIT_BOUNDARY_DESCRIPTION: the room the node keeps for itself while the claim is at its ceiling: the runner pod, its kubelet and the next case all write there, so a fill that leaves less has taken the host rather than the claim.
const HOST_HEADROOM_MIB = 1024;
// UNIT_BOUNDARY_DESCRIPTION: the request the refused guest makes, of the few MiB an agent's next write needs.
const NEXT_WRITE_MIB = 64;
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

// UNIT_BOUNDARY_DESCRIPTION: the machines the runner divides the claim's room among now: the owner's agents the platform reports running, since every agent on this lane runs on a machine of the runner's, and the lane's shared agent counts too, so the count is not this spec's own two. One for a count of none, as the runner reads an empty claim.
async function runningMachines(): Promise<number> {
  const states = await Promise.all(
    (await api.agents.list.query()).map(({ id }) =>
      api.agents.get.query({ id }).then((agent) => agent.state === "running"),
    ),
  );
  return Math.max(states.filter(Boolean).length, 1);
}

// UNIT_BOUNDARY_DESCRIPTION: wakes a machine and waits for it to run before a case reads it. The vm lane's idle sweep stops a machine whose harness reports idle for the chart's vmIdleTimeout, 5 minutes, and the per-agent hibernation timeout a spec can set is a container backend setting the vm backend ignores; a case's own work is guest-side and invisible to the sweep's probe, so each phase wakes its machines first and is bounded well inside that window.
async function keepAwake(id: string): Promise<void> {
  await api.agents.wake.mutate({ id });
  await waitAgentState(api, id, "running");
}

// UNIT_BOUNDARY_DESCRIPTION: the room the probe's guest can still write, in MiB: its share, less what it wrote, once the guard holds the rest.
function guestAvailMiB(): number {
  const line = inGuest(probeId, "df -Pk /home/agent | tail -1");
  return Math.round(Number(line.split(/\s+/)[3]) / 1024);
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
  await requireBackend(api, "vm");
  await acceptTerms(api);
  for (const name of [
    "e2e-storage-trim",
    "e2e-storage-trim-peer",
    "e2e-storage-trim-peer-1",
    "e2e-storage-trim-peer-2",
  ])
    await deleteAgentIfPresent(api, name);
  probeId = await createAgentOn(api, "vm", "e2e-storage-trim", harnessName);
  siblingId = await createAgentOn(
    api,
    "vm",
    "e2e-storage-trim-peer",
    harnessName,
  );
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

// TEST_SCENARIO: a share is the claim's room below its 95% ceiling divided among the machines that are running, so stopping a sibling doubles the probe's share and starting one halves it again, and the guard must take both moves and give the room back both ways: stopping the sibling grows the share, which shrinks the guard, and the guest's free space must rise; starting another grows the guard back, and the free space must fall. Two cycles, because a resize that frees only part of a preallocated extent loses a little room on every move, and the loss adds up. The claim's own use is not asserted here: every round boots a machine, and a boot writes onto the claim, so what the claim gains is the new machine's own room.
test("the guard gives a machine the room its share gains, and takes it back", async () => {
  test.setTimeout(900_000);
  test.skip(!probeDisk, "an earlier case did not measure a machine's disk");
  await keepAwake(probeId);
  await keepAwake(siblingId);
  const probeDiskBefore = machineDisks().get(probeDisk) ?? 0;
  for (const round of [1, 2]) {
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
      "vm",
      `e2e-storage-trim-peer-${round}`,
      harnessName,
    );
    await waitAgentState(api, siblingId, "running");
    await keepAwake(probeId);
    await waitFor(
      guestAvailMiB,
      (mib) => mib <= stopped - MOVE_MIB,
      `round ${round}: the guest's free space did not fall when another machine started`,
    );
  }
  expect(
    Math.abs((machineDisks().get(probeDisk) ?? 0) - probeDiskBefore),
    "the guard's moves must leave the probe's own disk where it was, since its blocks are marked in the guest's filesystem and never written onto the claim",
  ).toBeLessThanOrEqual(2 * MOVE_MIB);
});

// TEST_SCENARIO: a guest that writes past its share is refused by the guest, at its share and not at the claim's last block, and the refusal is a wedge only if it lasts: the owner's other agent still writes, the refused guest is still refused a renewal window later, and it writes again once a machine stops and its share grows. This is the defect a user reports — a steadily writing agent that hits "no space left on device" at three quarters of the storage and stays stuck — and it needs no room on the claim to reproduce: the guest's whole remaining room is marked with one preallocation, which the guest's own filesystem counts as used and the claim does not pay for, so the case costs a disk of the size the install already gives it and works on any pool. The refusal is read from the guest's own status and its own error file, never from a redirect into the data, which loses the error exactly when the disk is full.
test("a writing agent stops at its share, and writes again when its share grows", async () => {
  test.setTimeout(900_000);
  test.skip(!probeDisk, "an earlier case did not measure a machine's disk");
  await keepAwake(probeId);
  await keepAwake(siblingId);
  const diskBefore = machineDisks().get(probeDisk) ?? 0;
  // UNIT_BOUNDARY_DESCRIPTION: the share the runner publishes: the claim's room below its 95% level, divided among the machines that are running. This is the figure the refusal has to be measured against, since a guest refused at less than its share is the defect — the agent that hits "no space left" at three quarters of the storage — and a case that only compared the guest with itself could not see it. It costs the host nothing, which is why this case runs on every lane while the one that fills the claim does not.
  const before = claimKb();
  const shareMiB = Math.round(
    (0.95 * before.capacity - before.used) / 1024 / (await runningMachines()),
  );
  // UNIT_BOUNDARY_DESCRIPTION: the comparison allows one boot's worth of the claim's room, since a machine that started after the runner's last look has written onto the claim since the share was published, and the point of the check is a guest held to a fraction of its share rather than a figure to the MiB.
  expect(
    guestAvailMiB(),
    `the guest may write ${guestAvailMiB()} MiB of a share of ${shareMiB} MiB`,
  ).toBeGreaterThanOrEqual(shareMiB - GUARD_FLOOR_MIB);
  inGuest(probeId, "mkdir -p /tmp/e2e-fill");
  // UNIT_BOUNDARY_DESCRIPTION: a request of a fixed few MiB, made of a guest whose room is already marked: it is what the agent's next write looks like, and what a field stuck at its share refuses however long the machine runs.
  const request = () =>
    inGuest(
      probeId,
      `if fallocate -l ${NEXT_WRITE_MIB}M /tmp/e2e-fill/probe-$(date +%s%N) 2>/tmp/e2e-fill/probe.err; then echo "probe=marked"; else echo "probe=refused"; cat /tmp/e2e-fill/probe.err 2>/dev/null; fi`,
    );
  try {
    // UNIT_BOUNDARY_DESCRIPTION: the guest marks its whole remaining room in one file, so the case reaches its share in one call whatever the pool is: a loop of fixed chunks would never fill a 500 GiB share and would fail a healthy install by reaching its own cap instead.
    const marking = inGuest(
      probeId,
      [
        ROOM_KB,
        'if fallocate -l "$(( room / 1024 ))M" /tmp/e2e-fill/full 2>/tmp/e2e-fill/full.err; then echo "fill=marked"; else echo "fill=refused"; cat /tmp/e2e-fill/full.err 2>/dev/null; fi',
        "sync",
        AVAIL_KB,
      ].join("\n"),
    );
    const availMiB = Math.round(
      Number(/avail=(\d+)/.exec(marking)?.[1]) / 1024,
    );
    expect(
      Number.isFinite(availMiB),
      `the guest did not report its free space: ${marking}`,
    ).toBe(true);
    expect(
      availMiB,
      `the guest still had ${availMiB} MiB after marking its own room`,
    ).toBeLessThanOrEqual(GUARD_FLOOR_MIB + SLACK_MIB);
    const refused = await request();
    expect(
      refused,
      `the guest was not refused with ${availMiB} MiB it could still write: ${refused}`,
    ).toMatch(/probe=refused/);
    expect(
      refused,
      "the guest must be refused for want of space, not for another reason",
    ).toMatch(/No space left on device/);
    // UNIT_BOUNDARY_DESCRIPTION: the fill only marks blocks, so the claim must not have paid for it: a disk that grew by the fill is the guard handing the guest room the guest never wrote.
    const afterFill = machineDisks().get(probeDisk) ?? 0;
    expect(
      afterFill - diskBefore,
      `a marked fill took ${afterFill - diskBefore} MiB of the probe's disk on the claim`,
    ).toBeLessThanOrEqual(SLACK_MIB);
    // UNIT_BOUNDARY_DESCRIPTION: the refusal is the defect only if it lasts. The runner renews every grant on a 30 s look and the guard may move only once per 30 s backoff, so a field that recovers does so inside this window: a guest still refused after it is the wedge the user reports, and a guest that writes again here proves the recovery path rather than the timing.
    await new Promise((resolve) => setTimeout(resolve, RENEWAL_MS));
    await keepAwake(probeId);
    expect(
      await request(),
      "the refusal must outlast a renewal window to be the wedge this case is for",
    ).toMatch(/probe=refused/);
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
    // UNIT_BOUNDARY_DESCRIPTION: the agent refused at its share must write again once its share grows, which a wedged one does not: it keeps the answer to its last refusal however much room the owner frees. Its share grows when a sibling stops, and the room has to be room a real write lands in.
    const beforeRenew = guestAvailMiB();
    await api.agents.delete.mutate({ id: siblingId });
    siblingId = "";
    await waitFor(
      guestAvailMiB,
      (mib) => mib >= beforeRenew + MOVE_MIB,
      "the refused guest never got its room back when a machine stopped",
    );
    expect(
      inGuest(
        probeId,
        "head -c 64M /dev/urandom > /tmp/e2e-fill/after-renew && sync && wc -c < /tmp/e2e-fill/after-renew",
      ).trim(),
      "an agent refused at its share must write again once its share grows",
    ).toBe(String(64 * 1024 * 1024));
  } finally {
    // UNIT_BOUNDARY_DESCRIPTION: a failure leaves the fill on the machine, where it holds the guest at its share for a later case, so the room goes back whatever ends the case.
    await keepAwake(probeId).catch(() => undefined);
    await Promise.resolve(inGuest(probeId, "rm -rf /tmp/e2e-fill")).catch(
      () => undefined,
    );
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
  // UNIT_BOUNDARY_DESCRIPTION: the whole budget is reserved before the fill: the room below the claim's ceiling and the one floor a guest refused at its share may still write, so no write the case makes lands outside what it declared. `du` counts the blocks the guest holds, so a write refused part way still counts what it kept.
  const budgetMiB = needMiB + GUARD_FLOOR_MIB;
  test.skip(
    !Number.isFinite(capMiB) || capMiB <= 0 || budgetMiB > capMiB,
    `filling this claim to its ceiling reserves ${budgetMiB} MiB of real bytes on the host, and E2E_DISK_FILL_GIB allows ${Number.isFinite(capMiB) ? capMiB : 0} MiB`,
  );
  // UNIT_BOUNDARY_DESCRIPTION: the sibling is made and woken before the fill, not after it: a claim at its ceiling starts no machine, so a peer created once the claim is full would never reach running and the case would fail on its own setup.
  if (!siblingId)
    siblingId = await createAgentOn(
      api,
      "vm",
      "e2e-storage-trim-peer-2",
      harnessName,
    );
  await keepAwake(siblingId);
  const diskBefore = machineDisks().get(probeDisk) ?? 0;
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
    // UNIT_BOUNDARY_DESCRIPTION: the budget is spent a chunk at a time. A refusal with nothing left to write is not the wedge by itself: the runner republishes every grant on its 30 s look and the guard may move once per 30 s backoff, so the case waits that window out, writes again, and counts the refusal stable only when the write after the window is refused too. Both machines are woken every round, since the lane stops one whose harness reports idle for 5 minutes and a fill of several GiB outlasts that.
    const deadline = Date.now() + CEILING_MS;
    let availMiB = Number.POSITIVE_INFINITY;
    let refusalsInARow = 0;
    for (
      let chunk = 0;
      Date.now() < deadline && refusalsInARow < 2;
      chunk += 1
    ) {
      await keepAwake(probeId);
      await keepAwake(siblingId);
      const leftMiB = budgetMiB - writtenMiB();
      expect(
        leftMiB,
        `the fill spent its whole ${budgetMiB} MiB budget while the guest could still write ${availMiB} MiB and the claim held ${claimKb().used} KiB of its ${claimKb().capacity}`,
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
      `the fill wrote ${writtenMiB()} MiB of a budget of ${budgetMiB} MiB and the guest was still writing ${availMiB} MiB after a renewal window: the claim holds ${claimKb().used} KiB of its ${claimKb().capacity}, so this is not the ceiling`,
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
    await keepAwake(probeId).catch(() => undefined);
    await Promise.resolve(inGuest(probeId, "rm -rf /tmp/e2e-claim-fill")).catch(
      () => undefined,
    );
    await waitFor(
      () => machineDisks().get(probeDisk) ?? 0,
      (mib) => mib <= diskBefore + SLACK_MIB,
      "the deleted fill never left the claim",
    );
  }
});
