// TEST_OVERVIEW: a harness Template's agent runs on the node's harness tools. The Template boots the default image, which bakes none of the tools its harness runs: a per-node installer puts them in a host directory, the VM runner shares it read-only into the machine, and the agent's harness is picked from the Template. Only the vm lane runs it, with the Claude Code Template and the tools enabled; the mock agents of the rest of the suite bake their own tools. Nothing before the suite waits for the installer, which downloads the tools and can outlast the gate, so the spec waits for it before it boots the agent: a harness spawned before its tools are there exits at once. The same tools are what the guest kernel is held to: a guest that maps them with DAX must not lose a running process to SIGBUS.
import { expect, test } from "@playwright/test";

import {
  type ApiClient,
  createRefreshingApiClient,
} from "../../lib/api-client.js";
import { acceptTerms } from "../../lib/auth.js";
import {
  createAgentOn,
  refreshingToken,
  requireBackend,
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
  test.setTimeout(900_000);
  api = createRefreshingApiClient(token);
  await requireBackend(api, "vm");
  await acceptTerms(api);
  kubectl(
    "-n",
    AGENT_NS,
    "wait",
    "pod",
    "-l",
    "app.kubernetes.io/component=harness-tools",
    "--for=condition=Ready",
    "--timeout=600s",
  );
  agentId = await createAgentOn(api, "vm", "e2e-harness-tools", "claude-code");
});

test.afterAll(async () => {
  if (agentId) await api.agents.delete.mutate({ id: agentId });
});

// TEST_SCENARIO: the machine boots the default image, whose agent-runtime runs on node from the shared tools, and the Template's harness answers over the relay: Claude Code's ACP adapter, which only the tools directory holds, initializes and opens a session. A second client connecting to the same harness process is answered too, as a second tab or a reconnect would be.
test("boots on the node's tools and opens a Claude Code session, twice", async () => {
  test.setTimeout(900_000);
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

const DAX_REPRODUCER = `uname -r
grep ' /usr/share/mise ' /proc/mounts | head -1
node=$(ls -d /usr/share/mise/installs/node/*/bin/node | head -1)
for run in 1 2 3; do
  $node -e 'const t = Date.now(); while (Date.now() - t < 6000) require("zlib").deflateSync(Buffer.alloc(1e5));' &
  long=$!
  i=0; while [ $i -lt 300 ]; do head -c 1 $node >/dev/null; i=$((i+1)); done
  wait $long; echo "run $run rc=$?"
done
dmesg | grep -E 'Bad page map|Bad rss-counter' | head -5`;

// TEST_SCENARIO: the guest kernel is the pinned Linux 6.12, and a 6 GiB guest with the tools DAX-mapped keeps node running while other processes open its binary. From Linux 6.15 on, each open drops the DAX pages that the running process still maps, and that process dies of SIGBUS, exit 135 (smol-machines/smolvm#1741). A throwaway smolvm machine in the agent's runner boots the staged default image with the node's tools where the image reads them, and asks for DAX itself, so the guard holds whatever the runner sets for its own machines. The runner does set it: every mount of its own machines, the tools among them, is DAX-mapped. It runs only on an x86 runner in the cluster: smolvm maps no DAX window on arm64, and the Mac's host runner has no pod.
test("a 6 GiB guest runs node from DAX-mapped tools while its binary is opened, and the runner maps its machines' mounts with DAX", async () => {
  test.setTimeout(300_000);
  const owner = kubectl(
    "-n",
    AGENT_NS,
    "get",
    "agents.agent-platform.ai",
    agentId,
    "-o",
    "jsonpath={.metadata.labels.agent-platform\\.ai/owner}",
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
    "/var/lib/platform/tools:/usr/share/mise:ro",
    "--",
    "sh",
    "-c",
    DAX_REPRODUCER,
  );
  expect(guest).toMatch(/^6\.12\./m);
  expect(guest).toMatch(/ \/usr\/share\/mise virtiofs \S*dax=always/);
  expect(guest.match(/^run \d rc=\d+$/gm)).toEqual([
    "run 1 rc=0",
    "run 2 rc=0",
    "run 3 rc=0",
  ]);
  expect(guest).not.toMatch(/Bad page map|Bad rss-counter/);

  const mounts = inRunner(
    "sh",
    "-c",
    "grep -h '\"virtiofs mount active\"' /var/lib/platform/disks/.cache/smolvm/vms/*/agent-console.log",
  )
    .split("\n")
    .filter(Boolean);
  expect(
    mounts.length,
    "the runner's machines log their mounts",
  ).toBeGreaterThan(0);
  expect(
    mounts.filter((line) => !line.includes('"dax":true')),
    "every mount of the runner's own machines is DAX-mapped",
  ).toEqual([]);
});
