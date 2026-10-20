// TEST_OVERVIEW: the room a vm agent frees goes back to its owner's storage, and what an agent writes stays inside the share the runner grants it. A machine's disk is a sparse file on the owner's claim, so a file the agent deletes keeps its blocks on the claim until the guest's filesystem discards them, and platform-init is what trims them back (FITRIM): every minute, and before its storage guard preallocates the extents the guest just freed, since a preallocated extent is allocated and no trim reaches it afterwards. The guard is a preallocated file that holds the guest to its share, and it gives room back as a whole file of its own or as a file cut to nothing, because btrfs keeps the blocks of a preallocated extent a length alone partly truncated. Without both, the claim only ever grows and a writing agent wedges below the 95% ceiling: everything the owner is shown and refused for reads the claim. Only the vm lane runs this spec, it boots two of the owner's machines because a share is the claim's room divided among the ones running, and it measures each machine's own disk file, the claim itself, and the guest's free space.
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

// TEST_SCENARIO: a guest that writes past its share is refused by the guest, having reached its share and not the claim's last block: the refusal names no space, the claim is then within a few floors of its ceiling and not a third empty, every other agent of the owner still writes, and the refused guest writes again once a machine stops and its share grows, which is exactly what a wedge does not do. The fill is random bytes, because the machine's disk is compressed and zeros would never fill it, and it syncs before the claim is read, since the claim pays for it only once the guest's writes reach the disk. What the guest writes is what the claim pays, on the node's own disk, so E2E_DISK_FILL_GIB is the most GiB the fill may write and unset skips the case; a cap the guest reaches before it is full skips too, since a guest that still has room proves nothing about the ceiling. The fill goes in chunks that each wake the machine, since a machine idle for 5 minutes is stopped and a fill of a few GiB outlasts that.
test("a writing agent stops at its share, not at the claim", async () => {
  test.setTimeout(900_000);
  test.skip(!probeDisk, "an earlier case did not measure a machine's disk");
  const capGiB = Number(process.env.E2E_DISK_FILL_GIB ?? "");
  test.skip(
    !Number.isFinite(capGiB) || capGiB <= 0,
    "the fill writes onto the claim, which on this lane is the node's disk; set E2E_DISK_FILL_GIB to the most GiB the fill may write",
  );
  const capMiB = Math.floor(capGiB) * 1024;
  await keepAwake(probeId);
  const roomMiB = guestAvailMiB() - GUARD_FLOOR_MIB - SLACK_MIB;
  test.skip(
    capMiB < roomMiB,
    `a cap of ${capMiB} MiB cannot fill a guest with ${roomMiB} MiB to write`,
  );
  const diskBefore = machineDisks().get(probeDisk) ?? 0;
  let availMiB = Number.POSITIVE_INFINITY;
  let refused = false;
  inGuest(probeId, "mkdir -p /tmp/e2e-fill");
  try {
    // UNIT_BOUNDARY_DESCRIPTION: the fill goes in chunks with a wake of both machines between them, because the lane stops a machine whose harness reports idle for 5 minutes and a fill of a few GiB outlasts that, and the sibling must be up at the end, where the claim is past 95% and the runner starts no machine; the free space is read at each chunk so a cap the guest reaches early ends the fill there.
    for (
      let done = 0;
      done < capMiB && availMiB > GUARD_FLOOR_MIB + SLACK_MIB;
      done += FILL_CHUNK_MIB
    ) {
      await keepAwake(probeId);
      await keepAwake(siblingId);
      const out = inGuest(
        probeId,
        [
          `dd if=/dev/urandom bs=1M count=${Math.min(FILL_CHUNK_MIB, capMiB - done)} >> /tmp/e2e-fill/fill 2>&1 || true`,
          "sync",
          `echo "avail=$(df -Pk /home/agent | tail -1 | awk '{ print $4 }')"`,
        ].join("\n"),
      );
      availMiB = Math.round(Number(/avail=(\d+)/.exec(out)?.[1]) / 1024);
      expect(
        Number.isFinite(availMiB),
        `the guest did not report its free space: ${out}`,
      ).toBe(true);
      refused = /No space left on device/.test(out);
    }
    // UNIT_BOUNDARY_DESCRIPTION: the case needs a guest the guest itself refused: a fill that stopped on its cap proves nothing, and a guest refused anywhere but at its share is the wedge this case is for.
    test.skip(refused !== true, "the guest was not refused at its share");
    expect(
      availMiB,
      `the guest was refused with ${availMiB} MiB it could still write`,
    ).toBeLessThanOrEqual(GUARD_FLOOR_MIB + SLACK_MIB);
    await keepAwake(siblingId);
    const claim = claimKb();
    const running = await runningMachines();
    // UNIT_BOUNDARY_DESCRIPTION: a refused guest whose owner's claim is a third empty is the defect this case exists for: the guard held room the guest could not write, and the claim never came near its ceiling. So the claim has to reach the ceiling, not merely stay under it.
    expect(
      claim.used,
      `the claim holds ${claim.used} KiB of its ${claim.capacity}, short of the 94% a guest refused at its share must have reached`,
    ).toBeGreaterThanOrEqual(Math.round(0.94 * claim.capacity));
    expect(
      claim.used,
      `the claim holds ${claim.used} KiB of its ${claim.capacity}, past the 95% ceiling and the floor of ${running} machines`,
    ).toBeLessThanOrEqual(
      Math.round(0.95 * claim.capacity) + running * GUARD_FLOOR_MIB * 1024,
    );
    expect(
      inGuest(
        siblingId,
        "head -c 8M /dev/urandom > /tmp/e2e-still-writes && echo wrote",
      ),
      "the claim must stay writable for the owner's other agents",
    ).toBe("wrote");
    // UNIT_BOUNDARY_DESCRIPTION: the agent refused at its share must write again once its share grows, which a wedged one does not: it keeps the answer to its last refusal however much room the owner frees.
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
        "head -c 64M /dev/urandom > /tmp/e2e-fill/after-renew && echo wrote",
      ),
      "an agent refused at its share must write again once its share grows",
    ).toBe("wrote");
    await keepAwake(probeId);
    inGuest(probeId, "rm -rf /tmp/e2e-fill");
    await waitFor(
      () => machineDisks().get(probeDisk) ?? 0,
      (mib) => mib <= diskBefore + SLACK_MIB,
      "the deleted fill never left the claim",
    );
  } finally {
    // UNIT_BOUNDARY_DESCRIPTION: a skip or a failure leaves the fill on the claim, where it can hold a later spec's machine from starting, so the room goes back whatever ends the case.
    await keepAwake(probeId).catch(() => undefined);
    await Promise.resolve(inGuest(probeId, "rm -rf /tmp/e2e-fill")).catch(
      () => undefined,
    );
  }
});
