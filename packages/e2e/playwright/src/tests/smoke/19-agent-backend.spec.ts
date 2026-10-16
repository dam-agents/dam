// TEST_OVERVIEW: an agent is an agent like any other to its user, whichever Backend runs it. Both CI lanes run this spec, each on its own Backend: on the container lane the agent is a pod, on the vm lane a microVM on its owner's VM runner. On each, the agent boots, holds a chat turn, keeps a file written through the files API in HOME, takes a scheduled fire, and keeps that file across every way its sandbox goes down and comes back — hibernate and wake, the restart verb, and the pod that hosts it being deleted (the agent pod, or the owner's whole VM runner). HOME is the one path both Backends persist, so it is what each of those must keep. On the vm lane the runner it deletes also runs every other machine of the e2e user, so the Playwright config runs this spec there only after the rest of the suite has finished; on the container lane it runs after the agent project, whose provider connection the chat input needs, beside the specs that drive the shared e2e-agent and one at a time with the other specs that boot their own agent.
import { expect, test, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";

import {
  openAgentChat,
  sendMessageToAgent,
  setMockAgentReply,
} from "../../lib/agents.js";
import {
  type ApiClient,
  createRefreshingApiClient,
} from "../../lib/api-client.js";
import { acceptTerms } from "../../lib/auth.js";
import {
  createAgentOn,
  deleteBackendHost,
  expectHomeFile,
  inGuest,
  laneBackend,
  refreshingToken,
  requireBackend,
  runnerGrows,
  waitAgentState,
  writeHomeFile,
} from "../../lib/backend.js";
import { harnessName } from "../../lib/fixtures.js";

const markerPath = "e2e-backend-marker.txt";

test.describe.configure({ mode: "serial" });

let api: ApiClient;
const token = refreshingToken();
let agentId = "";
let agentName = "";
const marker = `home-survives-${randomUUID()}`;

async function chatTurn(
  page: Page,
  prompt: string,
  reply: string,
): Promise<void> {
  await setMockAgentReply(api, agentId, reply);
  await openAgentChat(page, agentName, agentId, { cardTimeoutMs: 120_000 });
  await sendMessageToAgent(page, prompt);
  await expect(page.getByText(reply)).toBeVisible({ timeout: 90_000 });
}

test.beforeAll(async () => {
  test.setTimeout(900_000);
  api = createRefreshingApiClient(token);
  await requireBackend(api, laneBackend);
  await acceptTerms(api);
  agentName = `e2e-${laneBackend}-lifecycle`;
  agentId = await createAgentOn(api, laneBackend, agentName, harnessName, {
    neverIdle: true,
  });
});

test.afterAll(async () => {
  if (agentId) await api.agents.delete.mutate({ id: agentId });
});

// TEST_SCENARIO: the first boot. On the vm Backend it may wait for the owner's VM runner to be created and the image to be mounted, so the wait is minutes rather than a pod's seconds. The chat turn proves the relay reaches the harness on this Backend.
test("boots and holds a chat turn", async ({ page }) => {
  test.setTimeout(900_000);
  await waitAgentState(api, agentId, "running");
  await chatTurn(page, "hello-backend", "backend-reply-first-boot");
});

// TEST_SCENARIO: on the vm Backend a machine boots with the install's boot estimate, 1 GiB in this lane, and the runner grows it to its size, half the runner's pool, once the guest is up. A grow that fails boots the machine again whole, so the agent still answers and nothing else in the suite would notice; the runner logs a grow as done only once the guest's virtio-mem driver plugged all the added RAM and its agent put it online. A guest that adds more than 1 GiB must not stall: smolvm before 1.28.1 plugged no more once 1 GiB waited offline (smol-machines/smolvm#1745), so the grow must add at least 3 GiB, and the lane's sizes cannot shrink below the bug unnoticed.
test("grows its machine past the boot RAM", async () => {
  test.skip(laneBackend !== "vm", "only a vm machine boots small and grows");
  test.setTimeout(120_000);
  await expect
    .poll(
      () =>
        runnerGrows(agentId).some(
          (grow) => grow.memory_mib - grow.boot_mib >= 3072,
        ),
      {
        timeout: 60_000,
        intervals: [3_000],
        message:
          "the runner logged no done grow of this agent's machine that added at least 3 GiB",
      },
    )
    .toBe(true);
});

// TEST_SCENARIO: every vm machine runs on the guest kernel, guest agent and runner this platform patches for them. HOME is the root of a btrfs subvolume of its own, mounted compressed with zstd level 1, under a UUID of the disk's own rather than the template's (the template's stays as its metadata UUID), and the guest swaps to zram compressed with zstd. An unpatched kernel has neither, and an unpatched agent or runner would mount ext4 or format over the disk.
test("keeps HOME on a compressed btrfs subvolume with its own UUID, and swaps to zram", async () => {
  test.skip(
    laneBackend !== "vm",
    "only a vm machine has a disk and a kernel of its own",
  );
  const guest = inGuest(
    agentId,
    "grep ' /home/agent ' /proc/self/mountinfo; for d in /sys/fs/btrfs/*-*; do echo \"fsid ${d##*/} metadata $(cat $d/metadata_uuid)\"; done; cat /proc/swaps; cat /sys/block/zram0/comp_algorithm",
  );
  expect(guest).toMatch(
    /^\S+ \S+ \S+ \/agent \/home\/agent .* - btrfs \/dev\/vda \S*compress=zstd:1/m,
  );
  const [, fsid, metadata] = /^fsid (\S+) metadata (\S+)$/m.exec(guest) ?? [];
  expect(fsid, "the guest mounted one btrfs filesystem").toBeDefined();
  expect(
    metadata,
    "the disk keeps the template's UUID as its metadata UUID",
  ).not.toEqual(fsid);
  expect(guest).toMatch(/^\/dev\/zram0\s+partition/m);
  expect(guest).toContain("[zstd]");
});

// TEST_SCENARIO: the guest's boot log, which holds the harness's output, is readable in the guest at /var/log/platform and cannot be rewritten there; the disk it lives on is detached after the boot, and the host never reads it.
test("shows the boot log read-only at /var/log/platform", async () => {
  test.skip(
    laneBackend !== "vm",
    "only a vm machine has platform-init as its init",
  );
  const guest = inGuest(
    agentId,
    "test -s /var/log/platform/agent-runtime.log && echo readable; touch /var/log/platform/x 2>/dev/null || echo read-only",
  );
  expect(guest).toContain("readable");
  expect(guest).toContain("read-only");
});

// TEST_SCENARIO: /tmp and /var/tmp are plain directories of the machine's root, not mounts of their own, and are open to every user as a temporary folder is; platform-init empties them at each boot.
test("keeps /tmp and /var/tmp as directories of the root", async () => {
  test.skip(
    laneBackend !== "vm",
    "only a vm machine has platform-init as its init",
  );
  const guest = inGuest(
    agentId,
    "grep -cE ' /(var/)?tmp ' /proc/self/mountinfo; stat -c '%a %U' /tmp /var/tmp",
  );
  expect(guest.split("\n")).toEqual(["0", "1777 root", "1777 root"]);
});

// TEST_SCENARIO: on the vm Backend the home dashboard shows the owner's memory and storage pools as meters read from the owner's runner, with this agent's own share in each.
test("shows its owner's pools on the home dashboard", async ({ page }) => {
  test.skip(laneBackend !== "vm", "only vm agents draw on a per-user pool");
  test.setTimeout(120_000);
  await page.goto("/");
  for (const pool of ["Memory", "Storage"])
    await expect(page.getByRole("meter", { name: pool })).toBeVisible({
      timeout: 60_000,
    });
  await expect(
    page
      .getByRole("group", { name: "Memory by agent" })
      .getByRole("button", { name: new RegExp(`^${agentName} · `) }),
  ).toBeVisible({ timeout: 60_000 });
});

// TEST_SCENARIO: the files API writes into the agent's HOME and reads the same bytes back. Every later scenario reads this file again, so it is the evidence that HOME survived.
test("keeps a file written to HOME", async () => {
  test.setTimeout(300_000);
  await writeHomeFile(token, agentId, markerPath, marker);
  await expectHomeFile(token, agentId, markerPath, marker, {
    timeoutMs: 60_000,
  });
});

// TEST_SCENARIO: a cron schedule's fire reaches the harness. The api-server delivers it over the runtime channel, the same path on both Backends, so a fire that never lands names the Backend's runtime channel as the broken part. The vm lane runs this spec alone at the end of the suite, so there it fires the schedule with run-now, which commits and delivers the same trigger, rather than wait up to a minute for the cron. The container lane runs it beside the rest of the suite and waits for the cron itself, so the scheduler's own fire stays covered.
test("takes a scheduled fire", async () => {
  test.setTimeout(300_000);
  const task = `e2e-backend-schedule-${randomUUID()}`;
  const schedule = await api.schedules.createCron.mutate({
    name: "e2e-backend-cron",
    agentId,
    cron: "* * * * *",
    task,
    sessionMode: "fresh",
  });
  try {
    if (laneBackend === "vm")
      await api.schedules.runNow.mutate({ id: schedule.id });
    await expect
      .poll(
        async () => {
          const { prompts } = await api.e2e.getReceivedPrompts.query({
            agentId,
          });
          return JSON.stringify(prompts).includes(task);
        },
        {
          timeout: 180_000,
          intervals: [3_000],
          message: "the scheduled task never reached the agent",
        },
      )
      .toBe(true);
    const { status } = await api.schedules.get.query({ id: schedule.id });
    expect(status?.lastResult).toBe("success");
  } finally {
    await api.schedules.delete.mutate({ id: schedule.id });
  }
});

// TEST_SCENARIO: sleep hibernates the agent, and wake brings it back. On the vm Backend that is a stop and a boot of the same machine, and HOME is its disk, so the marker must read back and the chat must answer after the boot.
test("hibernates and wakes with HOME intact", async ({ page }) => {
  test.setTimeout(900_000);
  await api.agents.sleep.mutate({ id: agentId });
  await waitAgentState(api, agentId, "hibernated");
  await api.agents.wake.mutate({ id: agentId });
  await waitAgentState(api, agentId, "running");
  await expectHomeFile(token, agentId, markerPath, marker);
  await chatTurn(page, "hello-after-wake", "backend-reply-after-wake");
});

// TEST_SCENARIO: the restart verb takes the agent down and up again without a hibernation. The agent must be seen to leave running, or the verb did nothing, and it must come back with HOME intact.
test("restarts with HOME intact", async ({ page }) => {
  test.setTimeout(900_000);
  await api.agents.restart.mutate({ id: agentId });
  await expect
    .poll(async () => (await api.agents.get.query({ id: agentId })).state, {
      timeout: 180_000,
      intervals: [500],
      message: "the agent never left running after the restart verb",
    })
    .not.toBe("running");
  await waitAgentState(api, agentId, "running", { failOnError: false });
  await expectHomeFile(token, agentId, markerPath, marker);
  await chatTurn(page, "hello-after-restart", "backend-reply-after-restart");
});

// TEST_SCENARIO: the pod that hosts the agent is deleted out from under it: the agent pod on the container Backend, the owner's VM runner — and with it every machine it runs — on the vm Backend. Nothing asked for it, so nothing but the controller's reconcile brings the machine back, and HOME must still be on the disk it boots.
test("comes back after its host pod is deleted, with HOME intact", async ({
  page,
}) => {
  test.setTimeout(1_200_000);
  await deleteBackendHost(agentId, laneBackend);
  await waitAgentState(api, agentId, "running", { failOnError: false });
  await expectHomeFile(token, agentId, markerPath, marker);
  await chatTurn(page, "hello-after-host-loss", "backend-reply-after-host");
});
