import type { AddressInfo } from "node:net";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WebSocketServer, type WebSocket as WsWebSocket } from "ws";
import { connectRawBridge } from "../modules/ssh/infrastructure/raw-bridge.js";

describe("connectRawBridge", () => {
  let wss: WebSocketServer | undefined;
  afterEach(() => {
    wss?.close();
    wss = undefined;
  });

  it("relays stdin→ws and ws→stdout, and resolves cleanly on close", async () => {
    const received: Buffer[] = [];
    let serverWs: WsWebSocket | undefined;
    const port = await new Promise<number>((resolve) => {
      wss = new WebSocketServer({ port: 0 }, () =>
        resolve((wss!.address() as AddressInfo).port),
      );
    });
    wss!.on("connection", (ws) => {
      serverWs = ws;
      ws.on("message", (d: Buffer) => received.push(Buffer.from(d)));
      ws.send(Buffer.from("from-server"));
    });

    const stdin = new PassThrough();
    const stdout = new PassThrough();
    const out: Buffer[] = [];
    stdout.on("data", (c: Buffer) => out.push(Buffer.from(c)));

    const bridge = connectRawBridge({
      host: `http://127.0.0.1:${port}`,
      token: "tok",
      agentId: "agent-x",
      stdin: stdin as unknown as NodeJS.ReadStream,
      stdout: stdout as unknown as NodeJS.WriteStream,
    });

    await vi.waitFor(() => expect(serverWs).toBeDefined());

    // ws → stdout (server's initial frame)
    await vi.waitFor(() =>
      expect(Buffer.concat(out).toString()).toContain("from-server"),
    );

    // stdin → ws
    stdin.write(Buffer.from("hello-server"));
    await vi.waitFor(() =>
      expect(Buffer.concat(received).toString()).toContain("hello-server"),
    );

    // Server-side close resolves the bridge with a clean (1000) code.
    serverWs!.close(1000);
    expect(await bridge).toBe(0);
  });

  it("resolves when stdin ends (ssh client closed the pipe)", async () => {
    const port = await new Promise<number>((resolve) => {
      wss = new WebSocketServer({ port: 0 }, () =>
        resolve((wss!.address() as AddressInfo).port),
      );
    });
    const stdin = new PassThrough();
    const stdout = new PassThrough();
    const bridge = connectRawBridge({
      host: `http://127.0.0.1:${port}`,
      token: "tok",
      agentId: "agent-x",
      stdin: stdin as unknown as NodeJS.ReadStream,
      stdout: stdout as unknown as NodeJS.WriteStream,
    });
    // End stdin once the socket is open.
    await new Promise((r) => setTimeout(r, 50));
    stdin.end();
    expect(await bridge).toBe(0);
  });
});
