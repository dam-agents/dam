// TEST_OVERVIEW: an agent is a machine on its owner's VM runner. It boots, holds a chat turn, keeps a file written through the files API in HOME, takes a scheduled fire, and keeps that file across every way its machine goes down and comes back — hibernate and wake, the restart verb, and the runner that hosts it being deleted. HOME is the one path a machine persists, so it is what each of those must keep. The runner it deletes also runs every other machine of the e2e user, so the Playwright config runs this spec only after the rest of the suite has finished.
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
  deleteRunnerHost,
  expectHomeFile,
  inGuest,
  refreshingToken,
  runnerGrows,
  waitAgentState,
  writeHomeFile,
} from "../../lib/backend.js";
import { harnessName } from "../../lib/fixtures.js";

const markerPath = "e2e-backend-marker.txt";
const prScope = process.env.E2E_SCOPE === "pr";

test.describe.configure({ mode: "serial" });

let api: ApiClient;
const token = refreshingToken();
let agentId = "";
let agentName = "";
const marker = `home-survives-${randomUUID()}`;
const probeService = "e2e-probe";
const probeStopped = `/home/agent/${probeService}.stopped`;
const startupItem = "e2e-item";
const startupItemRuns = `/home/agent/${startupItem}.runs`;

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
  test.setTimeout(300_000);
  api = createRefreshingApiClient(token);
  await acceptTerms(api);
  agentName = "e2e-vm-lifecycle";
  agentId = await createAgentOn(api, agentName, harnessName, {
    neverIdle: true,
  });
});

test.afterAll(async () => {
  if (agentId) await api.agents.delete.mutate({ id: agentId });
});

// TEST_SCENARIO: the first boot may wait for the owner's VM runner to be created and the image to be mounted, so the wait is minutes. The chat turn proves the relay reaches the harness.
test("boots and holds a chat turn", async ({ page }) => {
  test.setTimeout(300_000);
  await waitAgentState(api, agentId, "running");
  await chatTurn(page, "hello-backend", "backend-reply-first-boot");
});

// TEST_SCENARIO: a machine boots with the install's boot estimate, 1 GiB in this lane, and the runner grows it to its size, half the runner's pool, once the guest is up. A grow that fails boots the machine again whole, so the agent still answers and nothing else in the suite would notice; the runner logs a grow as done only once the guest's virtio-mem driver plugged all the added RAM and its agent put it online. A guest that adds more than 1 GiB must not stall: smolvm before 1.28.1 plugged no more once 1 GiB waited offline (smol-machines/smolvm#1745), so the grow must add at least 3 GiB, and the install's sizes cannot shrink below the bug unnoticed.
test("grows its machine past the boot RAM", async () => {
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

// TEST_SCENARIO: every machine runs on the guest kernel, guest agent and runner this platform patches for them. HOME is the root of a btrfs subvolume of its own, mounted compressed with zstd level 1, under a UUID of the disk's own rather than the template's (the template's stays as its metadata UUID), and the guest swaps to zram compressed with zstd. An unpatched kernel has neither, and an unpatched agent or runner would mount ext4 or format over the disk.
test("keeps HOME on a compressed btrfs subvolume with its own UUID, and swaps to zram", async () => {
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
  const guest = inGuest(
    agentId,
    "test -s /var/log/platform/agent-runtime.log && echo readable; touch /var/log/platform/x 2>/dev/null || echo read-only",
  );
  expect(guest).toContain("readable");
  expect(guest).toContain("read-only");
});

// TEST_SCENARIO: /tmp and /var/tmp are plain directories of the machine's root, not mounts of their own, and are open to every user as a temporary folder is; platform-init empties them at each boot.
test("keeps /tmp and /var/tmp as directories of the root", async () => {
  const guest = inGuest(
    agentId,
    "grep -cE ' /(var/)?tmp ' /proc/self/mountinfo; stat -c '%a %U' /tmp /var/tmp",
  );
  expect(guest.split("\n")).toEqual(["0", "1777 root", "1777 root"]);
});

// TEST_SCENARIO: the base image ships openrc, so platform-init boots its runlevels before the entrypoint, and runs the entrypoint in a cgroup of its own, which a restart of the entrypoint ends without openrc's services. A fresh machine's runlevels hold only the image's service that runs the agent's own services. The test then adds a system service of its own to the default runlevel and starts it, as an agent does, and a Startup Item, an openrc user service in ~/.config/rc that runs as root; openrc stops only a started service, and the hibernate-and-wake test reads back the service's stop and its start at the boot, and the item started again. The item records PLATFORM_GH_TOKEN_AVAILABLE, which the runtime sets and openrc's env filter drops, so only the runtime's ~/.config/rc/profile.env can give it to the item, at a start from the shell and at the boot.
test("boots openrc's runlevels and runs the entrypoint in its own cgroup", async () => {
  const guest = inGuest(
    agentId,
    "echo softlevel $(cat /run/openrc/softlevel); echo entrypoint $(wc -l < /sys/fs/cgroup/entrypoint/cgroup.procs)",
  );
  expect(guest).toMatch(/^softlevel default$/m);
  const [, procs] = /^entrypoint (\d+)$/m.exec(guest) ?? [];
  expect(Number(procs), "the entrypoint runs in its cgroup").toBeGreaterThan(0);
  expect(
    inGuest(agentId, "find /etc/runlevels -mindepth 2 -printf '%P\\n'").trim(),
    "a fresh machine starts only the agent's own services",
  ).toBe("default/user.root");
  inGuest(
    agentId,
    [
      `cat > /etc/init.d/${probeService} <<'EOF'`,
      "#!/sbin/openrc-run",
      "command=/bin/sleep",
      "command_args=infinity",
      "command_background=yes",
      `pidfile=/run/${probeService}.pid`,
      `stop_post() { touch ${probeStopped}; }`,
      "EOF",
      `chmod 755 /etc/init.d/${probeService}`,
      `rm -f ${probeStopped}`,
      `/sbin/rc-update add ${probeService} default >/dev/null`,
      `/sbin/rc-service ${probeService} start >/dev/null`,
      `rm -f ${startupItemRuns}`,
      "mkdir -p /home/agent/.config/rc/init.d /home/agent/.config/rc/runlevels/default",
      `cat > /home/agent/.config/rc/init.d/${startupItem} <<'EOF'`,
      "#!/sbin/openrc-run",
      "command=/bin/sh",
      `command_args="-c 'echo run >> ${startupItemRuns}; echo env \\\${PLATFORM_GH_TOKEN_AVAILABLE:-unset} >> ${startupItemRuns}; exec sleep infinity'"`,
      "EOF",
      `chmod 755 /home/agent/.config/rc/init.d/${startupItem}`,
      `ln -sf /home/agent/.config/rc/init.d/${startupItem} /home/agent/.config/rc/runlevels/default/${startupItem}`,
      `HOME=/home/agent XDG_RUNTIME_DIR=/tmp/platform-display rc-service --user ${startupItem} start >/dev/null`,
    ].join("\n"),
  );
  await expect
    .poll(() => inGuest(agentId, `cat ${startupItemRuns} 2>/dev/null; true`), {
      timeout: 30_000,
      message: "rc-service --user starts the item at once",
    })
    .toMatch(/^run$/m);
  expect(
    inGuest(agentId, `cat ${startupItemRuns}`),
    "the item has the runtime's env, which openrc's filter alone would drop",
  ).toMatch(/^env (true|false)$/m);
});

// TEST_SCENARIO: the image's docker is an openrc service the agent starts from its own shell. The daemon answers, gets the agent's gateway but no other variable of the agent's environment, has platform-runc first on its PATH, and openrc stops it again.
test("starts docker as an openrc service with only the gateway of the agent's environment", async () => {
  test.setTimeout(120_000);
  const guest = inGuest(
    agentId,
    [
      "agent=$(head -1 /sys/fs/cgroup/entrypoint/cgroup.procs)",
      "xargs -0 sh -c 'exec env -i \"$@\" /sbin/rc-service docker start' _ < /proc/$agent/environ >/dev/null",
      "docker=$(dirname $(readlink /proc/$(cat /run/dockerd.pid)/exe))/docker",
      "for i in $(seq 60); do $docker info >/dev/null 2>&1 && break; sleep 1; done",
      "echo info $($docker info --format '{{.DockerRootDir}}')",
      "env=$(tr '\\0' '\\n' < /proc/$(cat /run/dockerd.pid)/environ)",
      'echo "$env" | grep -q ^HTTPS_PROXY= && echo proxy',
      'echo "$env" | grep -q ^PLATFORM_AGENT_ID= && echo agent-id',
      'echo "$env" | grep -q ^PATH=/run/platform/bin: && echo runc-first',
      "/sbin/rc-service docker stop >/dev/null; echo stopped $(/sbin/rc-service docker status 2>&1 | grep -c stopped)",
    ].join("\n"),
  );
  expect(guest).toMatch(/^info \/home\/agent\/\.local\/share\/docker$/m);
  expect(guest, "dockerd pulls through the gateway").toMatch(/^proxy$/m);
  expect(guest, "no other variable reaches dockerd").not.toMatch(/^agent-id$/m);
  expect(guest, "dockerd runs platform-runc").toMatch(/^runc-first$/m);
  expect(guest).toMatch(/^stopped 1$/m);
});
// TEST_SCENARIO: the home dashboard shows the owner's memory and storage pools as meters read from the owner's runner, with this agent's own share in each.
test("shows its owner's pools on the home dashboard", async ({ page }) => {
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

// TEST_SCENARIO: a cron schedule's fire reaches the harness. The api-server delivers it over the runtime channel, so a fire that never lands names that channel as the broken part. This spec runs alone at the end of the suite, and a pull request runs a reduced set, so both fire the schedule with run-now, which commits and delivers the same trigger, rather than wait up to a minute for the cron; the merge queue's and the nightly run's full run waits for the cron itself, so the scheduler's own fire stays covered there. The schedule's next occurrence is read either way: on the cron path it shows the fire scheduled the next occurrence, and run-now leaves the cron where it was.
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
    if (prScope) await api.schedules.runNow.mutate({ id: schedule.id });
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
          intervals: [1_000, 2_000, 3_000],
          message: "the scheduled task never reached the agent",
        },
      )
      .toBe(true);
    const { status } = await api.schedules.get.query({ id: schedule.id });
    expect(status?.lastResult).toBe("success");
    expect(
      status?.nextRun,
      "the schedule carries no next occurrence",
    ).toBeTruthy();
  } finally {
    await api.schedules.delete.mutate({ id: schedule.id });
  }
});

// TEST_SCENARIO: sleep hibernates the agent, and wake brings it back: a stop and a boot of the same machine, and HOME is its disk, so the marker must read back and the chat must answer after the boot. The openrc service the agent added to the default runlevel ran its stop_post on the stop, and runs again after the boot.
test("hibernates and wakes with HOME intact", async ({ page }) => {
  test.setTimeout(300_000);
  await api.agents.sleep.mutate({ id: agentId });
  await waitAgentState(api, agentId, "hibernated");
  await api.agents.wake.mutate({ id: agentId });
  await waitAgentState(api, agentId, "running");
  await expectHomeFile(token, agentId, markerPath, marker);
  const guest = inGuest(
    agentId,
    `test -e ${probeStopped} && echo stopped; /sbin/rc-service ${probeService} status 2>&1; echo item-runs $(grep -c '^run$' ${startupItemRuns}); echo item-env $(grep -cE '^env (true|false)$' ${startupItemRuns}); true`,
  );
  expect(guest, "openrc ran the service's stop_post on the stop").toMatch(
    /^stopped$/m,
  );
  expect(
    guest,
    "the service in the default runlevel started at the boot",
  ).toMatch(/status: started/);
  expect(guest, "the Startup Item started again at the boot").toMatch(
    /^item-runs 2$/m,
  );
  expect(
    guest,
    "the item has the runtime's env at the boot, before the runtime starts",
  ).toMatch(/^item-env 2$/m);
  inGuest(
    agentId,
    [
      `/sbin/rc-update del ${probeService} default >/dev/null`,
      `HOME=/home/agent XDG_RUNTIME_DIR=/tmp/platform-display rc-service --user ${startupItem} stop >/dev/null`,
      `rm -f /home/agent/.config/rc/runlevels/default/${startupItem} /home/agent/.config/rc/init.d/${startupItem}`,
    ].join("\n"),
  );
  await chatTurn(page, "hello-after-wake", "backend-reply-after-wake");
});

// TEST_SCENARIO: the restart verb takes the agent down and up again without a hibernation. The agent must be seen to leave running, or the verb did nothing, and it must come back with HOME intact.
test("restarts with HOME intact", async ({ page }) => {
  test.setTimeout(300_000);
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

// TEST_SCENARIO: the runner that hosts the agent is deleted out from under it, and with it every machine it runs. Nothing asked for it, so nothing but the controller's reconcile brings the machine back, and HOME must still be on the disk it boots.
test("comes back after its host pod is deleted, with HOME intact", async ({
  page,
}) => {
  test.setTimeout(300_000);
  await deleteRunnerHost(agentId);
  await waitAgentState(api, agentId, "running", { failOnError: false });
  await expectHomeFile(token, agentId, markerPath, marker);
  await chatTurn(page, "hello-after-host-loss", "backend-reply-after-host");
});
