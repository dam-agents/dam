// TEST_OVERVIEW: a harness Template's agent runs on the harness tools the default image bakes. The Template boots the default image, and the agent's harness is picked from the Template. Only a run with the Claude Code Template enabled takes it; the mock agents of the rest of the suite carry their own tools. The same tools are what the guest kernel is held to: a guest that maps them with DAX must not corrupt the pages a running process maps, nor stall when its working set outgrows the DAX window.
import { expect, test } from "@playwright/test";

import {
  type ApiClient,
  createRefreshingApiClient,
} from "../../lib/api-client.js";
import { acceptTerms } from "../../lib/auth.js";
import {
  createAgentOn,
  refreshingToken,
  waitAgentState,
} from "../../lib/backend.js";
import { AGENT_NS, kubectl } from "../../lib/cluster.js";
import { baseUrl } from "../../config.js";

test.describe.configure({ mode: "serial" });

let api: ApiClient;
const token = refreshingToken();
let agentId = "";

type Frame = { id?: number; result?: Record<string, unknown>; error?: unknown };

async function openSession(): Promise<Frame[]> {
  const url = `${baseUrl.replace(/^http/, "ws")}/api/agents/${agentId}/acp?token=${await token()}`;
  const ws = new WebSocket(url);
  const answers: Frame[] = [];
  let next = 0;
  const send = (method: string, params: object) =>
    ws.send(JSON.stringify({ jsonrpc: "2.0", id: ++next, method, params }));
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () =>
          reject(
            new Error(`no ACP answer in time: ${JSON.stringify(answers)}`),
          ),
        120_000,
      );
      ws.onopen = () =>
        send("initialize", { protocolVersion: 1, clientCapabilities: {} });
      ws.onerror = () => {
        clearTimeout(timer);
        reject(new Error("the ACP relay closed the connection"));
      };
      ws.onmessage = (event) => {
        const frame = JSON.parse(String(event.data)) as Frame;
        if (frame.id === undefined || "method" in frame) return;
        answers.push(frame);
        if (frame.id === 1)
          send("session/new", { cwd: "/home/agent/work", mcpServers: [] });
        if (frame.id === 2) {
          clearTimeout(timer);
          resolve();
        }
      };
    });
  } finally {
    ws.close();
  }
  return answers;
}

test.beforeAll(async () => {
  test.setTimeout(300_000);
  api = createRefreshingApiClient(token);
  await acceptTerms(api);
  agentId = await createAgentOn(api, "e2e-harness-tools", "claude-code");
});

test.afterAll(async () => {
  if (agentId) await api.agents.delete.mutate({ id: agentId });
});

// TEST_SCENARIO: the machine boots the default image, whose agent-runtime runs on node from the baked tools, and the Template's harness answers over the relay: Claude Code's ACP adapter, which only the tools hold, initializes and opens a session. A second client connecting to the same harness process is answered too, as a second tab or a reconnect would be.
test("boots on the baked tools and opens a Claude Code session, twice", async () => {
  test.setTimeout(300_000);
  await waitAgentState(api, agentId, "running");

  for (const connection of ["first", "second"]) {
    const [init, session] = await openSession();
    expect(init?.error, `${connection} initialize`).toBeUndefined();
    expect(
      init?.result?.agentCapabilities,
      `${connection} initialize`,
    ).toBeDefined();
    expect(session?.error, `${connection} session/new`).toBeUndefined();
    expect(typeof session?.result?.sessionId, `${connection} session/new`).toBe(
      "string",
    );
  }
});

const DAX_CHECKS = `uname -r
grep ' /usr/share/mise ' /proc/mounts | head -1
node=$(ls -d /usr/share/mise/installs/node/*/bin/node | head -1)
python=$(ls -d /usr/share/mise/installs/python/3.*/bin/python3 | head -1)
$node -e 'const t = Date.now(); while (Date.now() - t < 2000) require("zlib").deflateSync(Buffer.alloc(1e5));' &
long=$!
i=0; while [ $i -lt 300 ]; do head -c 1 $node >/dev/null; i=$((i+1)); done
wait $long; echo "reproducer rc=$?"
for n in 1 2 3; do
  ( timeout -s KILL 20 $python -c '
import mmap, sys, time
maps, size = [], 0
for path in sys.argv[2:]:
    if size >= 3 << 30: break
    with open(path, "rb") as f: maps.append(mmap.mmap(f.fileno(), 0, prot=mmap.PROT_READ))
    size += len(maps[-1])
maps = maps[int(sys.argv[1]):] + maps[:int(sys.argv[1])]
end, passes = time.monotonic() + 2, 0
while passes == 0 or time.monotonic() < end:
    for m in maps:
        for offset in range(0, len(m), 2 << 20): m[offset]
    passes += 1
print("mapped", size >> 20, "MiB")
' $((n * 7)) $FILES; echo "reclaim rc=$?" ) >/tmp/reclaim.$n 2>&1 &
done
end=$(($(date +%s) + 22))
while [ $(date +%s) -lt $end ] && [ $(cat /tmp/reclaim.* | grep -c '^reclaim rc=') -lt 3 ]; do sleep 0.2; done
cat /tmp/reclaim.*
stuck=$(grep -l '^State:.*(disk sleep)' /proc/[0-9]*/status 2>/dev/null)
[ -z "$stuck" ] || sleep 1
for s in $stuck; do grep -qs '^State:.*(disk sleep)' $s && echo "stuck $(grep '^Name:' $s | cut -f2)"; done
if dmesg | grep -qE 'Bad page map|Bad rss-counter|cut here'; then echo '--- guest kernel log ---'; dmesg; fi`;

// TEST_SCENARIO: the guest kernel passes the DAX checks that Linux 6.18 failed until smol-machines/libkrunfw#31, so a smolvm release whose kernel lacks the fix fails here. A throwaway smolvm machine in the agent's runner boots the staged default image with its own tools mounted again where the image reads them, a mount of their own, and asks for DAX itself, so the checks hold whatever the runner sets for its own machines. The runner does set it: every mount of its own machines, the tools among them, is DAX-mapped. First check: node runs from the tools while other processes open its binary. On 6.18 each open drops DAX pages that node still maps: the kernel logs a WARN and Bad page map, and in a guest of 6 GiB or more node dies of SIGBUS, exit 135 (smol-machines/smolvm#1741). Second check: three processes map 3 GiB of the tools, more than the mount's 2 GiB DAX window, and touch every 2 MiB range, so the guest must reclaim ranges that processes still map. On 6.18 that reclaim waits forever: the processes stay in D state and the guest stalls. A 2 GiB guest shows only the WARN, so the guest is 6 GiB, and the checks time out inside the guest, since smolvm prints the guest's output only when it exits. It runs only on an x86 runner in the cluster: smolvm maps no DAX window on arm64, and the Mac's host runner has no pod.
test("a 6 GiB guest passes the DAX checks on the image's tools, and the runner maps its machines' mounts with DAX", async () => {
  test.setTimeout(300_000);
  const owner = kubectl(
    "-n",
    AGENT_NS,
    "get",
    "configmaps",
    "-l",
    `agent-platform.ai/agent=${agentId}`,
    "-o",
    "jsonpath={.items[0].metadata.labels.agent-platform\\.ai/owner}",
  );
  const pod = kubectl(
    "-n",
    AGENT_NS,
    "get",
    "pod",
    "-l",
    `app.kubernetes.io/component=vm-runner,agent-platform.ai/owner=${owner}`,
    "-o",
    "jsonpath={.items[0].metadata.name}",
  );
  test.skip(!pod, "the Mac's host runner runs outside the cluster");
  const inRunner = (...args: string[]) =>
    kubectl("-n", AGENT_NS, "exec", pod, "-c", "vm-runner", "--", ...args);
  test.skip(
    inRunner("uname", "-m") !== "x86_64",
    "smolvm maps no DAX window on arm64",
  );
  const image = inRunner("ls", "/var/lib/platform/images")
    .split("\n")
    .find((entry) => entry.includes("default") && !entry.endsWith(".tar"));
  expect(image, "the staged default image").toBeDefined();
  const tools = `/var/lib/platform/images/${image}/rootfs/usr/share/mise`;
  const bigTools = inRunner("find", tools, "-type", "f", "-size", "+4M")
    .split("\n")
    .sort()
    .map((path) => path.replace(tools, "/usr/share/mise"));
  const guest = inRunner(
    "env",
    "HOME=/tmp/e2e-dax-guard",
    "SMOLVM_MOUNT_DAX=1",
    "timeout",
    "240",
    "/opt/smolvm/smolvm",
    "machine",
    "run",
    "--mem",
    "6144",
    "--cpus",
    "2",
    "--image",
    `/var/lib/platform/images/${image}/rootfs`,
    "-v",
    `${tools}:/usr/share/mise:ro`,
    "-e",
    `FILES=${bigTools.join(" ")}`,
    "--",
    "sh",
    "-c",
    DAX_CHECKS,
  );
  expect(guest).toMatch(/ \/usr\/share\/mise virtiofs \S*dax=always/);
  expect(guest).toMatch(/^reproducer rc=0$/m);
  expect(guest.match(/^reclaim rc=\d+$/gm)).toEqual([
    "reclaim rc=0",
    "reclaim rc=0",
    "reclaim rc=0",
  ]);
  expect(
    [...guest.matchAll(/^mapped (\d+) MiB$/gm)].map(
      ([, mib]) => Number(mib) > 2048,
    ),
    "each process maps more than the 2 GiB DAX window",
  ).toEqual([true, true, true]);
  expect(guest).not.toMatch(/^stuck /m);
  expect(guest).not.toMatch(/Bad page map|Bad rss-counter|cut here/);

  const mounts = inRunner(
    "sh",
    "-c",
    "grep -h 'virtiofs mount active:' /var/lib/platform/disks/.cache/smolvm/vms/*/agent-console.log",
  )
    .split("\n")
    .filter(Boolean);
  expect(
    mounts.length,
    "the runner's machines log their mounts",
  ).toBeGreaterThan(0);
  expect(
    mounts.filter((line) => !line.includes("dax=true")),
    "every mount of the runner's own machines is DAX-mapped",
  ).toEqual([]);
});
