// TEST_OVERVIEW: a harness Template's agent runs on the node's harness tools. The Template boots the default image, which bakes none of the tools its harness runs: a per-node installer puts them in a host directory, the VM runner shares it read-only into the machine, and the agent's harness is picked from the Template. Only the vm lane runs it, with the Claude Code Template and the tools enabled; the mock agents of the rest of the suite bake their own tools.
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
  await requireBackend(api, "vm");
  await acceptTerms(api);
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
