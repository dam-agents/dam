import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import { WebSocket, WebSocketServer } from "ws";
import { afterAll, describe, expect, it, vi } from "vitest";
import { createRunRelay } from "../../apps/harness-api-server/harness-run-relay.js";
import type { RunsService } from "../../modules/runs/services/runs-service.js";
import type {
  K8sClient,
  KubeObject,
} from "../../modules/agents/infrastructure/k8s.js";
import { LABEL_OWNER } from "../../modules/agents/infrastructure/labels.js";

// Terminal-protocol opcodes (see api-server-api terminal/protocol.ts).
const OP_INPUT = 0x00;
const OP_OUTPUT = 0x01;
const OP_EXIT = 0x03;

const DAM_RUN = fileURLToPath(
  new URL("../../../../platform-base/dam-run.mjs", import.meta.url),
);

const agentCR: KubeObject = {
  metadata: { name: "a1", uid: "uid-a1", labels: { [LABEL_OWNER]: "owner" } },
};

// Stands in for the executor pod's agent-runtime: echoes stdin frames back as
// output and treats EOT (what dam-run sends on piped-stdin end) as "command
// read to EOF", exiting 0 like the real PTY would.
async function fakeExec(): Promise<{ wss: WebSocketServer; port: number }> {
  const wss = new WebSocketServer({ port: 0 });
  wss.on("connection", (ws) => {
    ws.on("message", (raw: Buffer) => {
      if (raw[0] !== OP_INPUT) return;
      const data = raw.subarray(1);
      if (data.includes(0x04)) {
        ws.send(Buffer.from([OP_EXIT, 0]));
        ws.close(1000, "exec exited");
      } else {
        ws.send(Buffer.concat([Buffer.from([OP_OUTPUT]), data]));
      }
    });
  });
  await once(wss, "listening");
  return { wss, port: (wss.address() as AddressInfo).port };
}

async function relayServer(deps: {
  k8s: K8sClient;
  runs: RunsService;
  executorPort: number;
  enabled?: boolean;
}): Promise<Server> {
  // The machinery stays tested while dam-run is disabled in production
  // (#2989) — tests opt in explicitly.
  const relay = createRunRelay({ enabled: true, ...deps });
  const server = createServer();
  server.on("upgrade", (req, socket, head) =>
    relay.handleUpgrade(req, socket, head, "a1"),
  );
  server.listen(0);
  await once(server, "listening");
  return server;
}

const cleanups: (() => void)[] = [];
afterAll(() => cleanups.forEach((fn) => fn()));

describe("harness-run-relay", () => {
  it("relays a full dam-run session and deletes the Run CR on close", async () => {
    const exec = await fakeExec();
    const deleted: string[] = [];
    const runs: RunsService = {
      newRunId: () => "run-happy",
      create: async () => {},
      waitReady: async () => "127.0.0.1",
      delete: async (id) => {
        deleted.push(id);
      },
      listRunIds: async () => [],
    };
    const k8s = {
      getCustomObject: async () => agentCR,
    } as unknown as K8sClient;
    const server = await relayServer({ k8s, runs, executorPort: exec.port });
    cleanups.push(() => {
      server.close();
      exec.wss.close();
    });

    const port = (server.address() as AddressInfo).port;
    // The real CLI as the client: covers its framing, EOT-on-stdin-end, and
    // exit-code propagation against the real relay.
    const child = spawn(process.execPath, [DAM_RUN, "cat"], {
      env: {
        ...process.env,
        PLATFORM_MCP_URL: `http://127.0.0.1:${port}/api/agents/a1/mcp`,
      },
      stdio: ["pipe", "pipe", "pipe"],
    });
    child.stdin.end("hi\n");
    let stdout = "";
    child.stdout.on("data", (d: Buffer) => (stdout += d.toString()));
    let stderr = "";
    child.stderr.on("data", (d: Buffer) => (stderr += d.toString()));

    const [code] = (await once(child, "exit")) as [number];
    expect(stderr).toBe("");
    expect(code).toBe(0);
    expect(stdout).toContain("hi");
    await vi.waitFor(() => expect(deleted).toContain("run-happy"));
  });

  it("refuses every dial with a clear close reason while disabled (the production default)", async () => {
    const runs: RunsService = {
      newRunId: () => {
        throw new Error("no run may be minted while disabled");
      },
      create: async () => {
        throw new Error("no Run CR may be created while disabled");
      },
      waitReady: () => new Promise<string>(() => {}),
      delete: async () => {},
      listRunIds: async () => [],
    };
    const k8s = {} as unknown as K8sClient;
    // No `enabled` — createRunRelay defaults to disabled, exactly like the
    // composition root.
    const relay = createRunRelay({ k8s, runs, executorPort: 1 });
    const server = createServer();
    server.on("upgrade", (req, socket, head) =>
      relay.handleUpgrade(req, socket, head, "a1"),
    );
    server.listen(0);
    await once(server, "listening");
    cleanups.push(() => server.close());

    const port = (server.address() as AddressInfo).port;
    const client = new WebSocket(`ws://127.0.0.1:${port}/api/agents/a1/run`);
    const [code, reason] = (await once(client, "close")) as [number, Buffer];
    expect(code).toBe(1008);
    expect(reason.toString()).toContain("temporarily disabled");
  });

  it("releases the run when the client disconnects during agent resolution", async () => {
    const deleted: string[] = [];
    const runs: RunsService = {
      newRunId: () => "run-early-close",
      create: async () => {
        throw new Error("create must not run for a gone client");
      },
      waitReady: () => new Promise<string>(() => {}),
      delete: async (id) => {
        deleted.push(id);
      },
      listRunIds: async () => [],
    };
    const k8s = {
      // Slow resolve: the client's close lands inside this window.
      getCustomObject: () =>
        new Promise<KubeObject>((r) => setTimeout(() => r(agentCR), 100)),
    } as unknown as K8sClient;
    const server = await relayServer({ k8s, runs, executorPort: 1 });
    cleanups.push(() => server.close());

    const port = (server.address() as AddressInfo).port;
    const client = new WebSocket(`ws://127.0.0.1:${port}/api/agents/a1/run`);
    client.on("open", () => client.close());

    await vi.waitFor(() => expect(deleted).toContain("run-early-close"));
  });
});
