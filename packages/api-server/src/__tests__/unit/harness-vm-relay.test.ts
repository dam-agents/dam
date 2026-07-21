import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocket, WebSocketServer } from "ws";
import { afterAll, describe, expect, it } from "vitest";
import { createVmRelay } from "../../apps/harness-api-server/harness-vm-relay.js";

// Terminal-protocol opcodes (see api-server-api terminal/protocol.ts).
const OP_INPUT = 0x00;
const OP_OUTPUT = 0x01;
const OP_EXIT = 0x03;
const OP_EOF = 0x05; // dam-vm's raw (no-PTY) stdin-EOF signal

// dam-vm is dam-run.mjs invoked under the vm name (a symlink in the image);
// recreate that here — the script picks its mode from argv[1]'s basename.
const DAM_VM = join(mkdtempSync(join(tmpdir(), "dam-vm-cli-")), "dam-vm.mjs");
symlinkSync(
  fileURLToPath(
    new URL("../../../../platform-base/dam-run.mjs", import.meta.url),
  ),
  DAM_VM,
);

// Stands in for dam-vm-server on the VM host: records the auth headers the
// relay attached, echoes input frames back as output, and treats OP_EOF (what
// dam-vm sends on piped-stdin end) as "command read to EOF", exiting 0.
async function fakeVmHost(): Promise<{
  wss: WebSocketServer;
  url: string;
  seen: { agent: unknown }[];
}> {
  // Plain-ws stand-in for dam-vm-server; the real mTLS handshake is covered by
  // packages/dam-vm's auth test. Here we assert the relay attaches the agent
  // identity.
  const seen: { agent: unknown }[] = [];
  const wss = new WebSocketServer({ port: 0, path: "/run" });
  wss.on("connection", (ws, req) => {
    seen.push({ agent: req.headers["x-dam-vm-agent"] });
    ws.on("message", (raw: Buffer) => {
      if (raw[0] === OP_EOF) {
        ws.send(Buffer.from([OP_EXIT, 0]));
        ws.close(1000);
      } else if (raw[0] === OP_INPUT) {
        ws.send(Buffer.concat([Buffer.from([OP_OUTPUT]), raw.subarray(1)]));
      }
    });
  });
  await once(wss, "listening");
  const port = (wss.address() as AddressInfo).port;
  return { wss, seen, url: `ws://127.0.0.1:${port}/run` };
}

async function relayServer(deps: {
  url: string | null;
  clientCert: string | null;
  clientKey: string | null;
}): Promise<Server> {
  const relay = createVmRelay(deps);
  const server = createServer();
  server.on("upgrade", (req, socket, head) =>
    relay.handleUpgrade(req, socket, head, "a1"),
  );
  server.listen(0);
  await once(server, "listening");
  return server;
}

function runCli(port: number, args: string[]) {
  const child = spawn(process.execPath, [DAM_VM, ...args], {
    env: {
      ...process.env,
      PLATFORM_MCP_URL: `http://127.0.0.1:${port}/api/agents/a1/mcp`,
    },
    stdio: ["pipe", "pipe", "pipe"],
  });
  let stdout = "";
  child.stdout.on("data", (d: Buffer) => (stdout += d.toString()));
  let stderr = "";
  child.stderr.on("data", (d: Buffer) => (stderr += d.toString()));
  return { child, out: () => stdout, err: () => stderr };
}

const cleanups: (() => void)[] = [];
afterAll(() => cleanups.forEach((fn) => fn()));

describe("harness-vm-relay", () => {
  it("relays a dam-vm session, attaching the agent identity", async () => {
    const vm = await fakeVmHost();
    const server = await relayServer({
      url: vm.url,
      clientCert: "cert-pem",
      clientKey: "key-pem",
    });
    cleanups.push(() => {
      server.close();
      vm.wss.close();
    });

    const port = (server.address() as AddressInfo).port;
    // The real CLI as the client: covers its framing, EOT-on-stdin-end, and
    // exit-code propagation against the real relay.
    const { child, out, err } = runCli(port, ["cat"]);
    child.stdin.end("hi\n");

    const [code] = (await once(child, "exit")) as [number];
    expect(err()).toBe("");
    expect(code).toBe(0);
    expect(out()).toContain("hi");
    // Identity forwarded (the hop itself is authenticated by mTLS).
    expect(vm.seen).toEqual([{ agent: "a1" }]);
  });

  it("tells the agent when no VM host is configured", async () => {
    const server = await relayServer({
      url: null,
      clientCert: null,
      clientKey: null,
    });
    cleanups.push(() => server.close());

    const port = (server.address() as AddressInfo).port;
    const { child, err } = runCli(port, ["true"]);
    const [code] = (await once(child, "exit")) as [number];
    expect(code).toBe(1);
    expect(err()).toContain("no VM host is configured");
  });

  it("forwards the VM host's rejection code and reason to the agent", async () => {
    const wss = new WebSocketServer({ port: 0, path: "/run" });
    wss.on("connection", (ws) => ws.close(4403, "agent denied"));
    await once(wss, "listening");
    const url = `ws://127.0.0.1:${(wss.address() as AddressInfo).port}/run`;
    const server = await relayServer({ url, clientCert: "c", clientKey: "k" });
    cleanups.push(() => {
      server.close();
      wss.close();
    });

    const port = (server.address() as AddressInfo).port;
    const client = new WebSocket(`ws://127.0.0.1:${port}/api/agents/a1/vm`);
    const [code, reason] = (await once(client, "close")) as [number, Buffer];
    expect(code).toBe(4403);
    expect(reason.toString()).toBe("agent denied");
  });
});
