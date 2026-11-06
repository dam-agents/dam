// TEST_OVERVIEW: a harness Template's agent runs on the harness tools the default image bakes. The Template boots the default image, and the agent's harness is picked from the Template. Only a run with the Claude Code Template enabled takes it; the mock agents of the rest of the suite carry their own tools. The runner maps those tools in a way of their own, so the mounts its machines boot with are checked here too.
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

// TEST_SCENARIO: the runner maps every mount of its own machines with DAX but the image tree, which holds the tools: that one platform-init copies through a 4 MiB read-ahead, since a DAX-mapped one reads too slowly for a cold start of Chrome or the Claude binary (boot::vm::ShareRead). Each machine's console logs the mounts it made, so the check reads them in the runner pod, after the machine above has booted. It runs only on an x86 runner in the cluster: smolvm maps no DAX window on arm64, and the Mac's host runner has no pod.
test("the runner maps its machines' mounts with DAX, and the image tree through a read-ahead", async () => {
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
  const imageTree = (line: string) =>
    line.includes(" at /run/platform-boot/image,");
  expect(
    mounts.filter((line) => !imageTree(line) && !line.includes("dax=true")),
    "every mount of the runner's own machines but the image tree is DAX-mapped",
  ).toEqual([]);
  const trees = mounts.filter(imageTree);
  expect(
    trees.length,
    "the runner's machines log their image tree",
  ).toBeGreaterThan(0);
  expect(
    trees.filter((line) => !line.includes("dax=false, read_ahead=4096KiB")),
    "the image tree, which holds the tools, is copied through a 4 MiB read-ahead",
  ).toEqual([]);
});
