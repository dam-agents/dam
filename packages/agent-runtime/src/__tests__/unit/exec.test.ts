import { EventEmitter } from "node:events";
import { describe, it, expect } from "vitest";
import type { WebSocket as WsWebSocket } from "ws";
import {
  OP_OUTPUT,
  OP_EXIT,
  OP_INPUT,
  decodeFrame,
  encodeDataFrame,
} from "api-server-api";
import { attachExec } from "../../modules/exec.js";

// Stand-in for the ws socket: records sent frames, lets the test push inbound
// frames via emit("message", ...), and resolves once OP_EXIT arrives.
class FakeWs extends EventEmitter {
  binaryType = "nodebuffer";
  readyState = 1;
  sent: Uint8Array[] = [];
  private resolveExit!: (code: number) => void;
  exited = new Promise<number>((r) => {
    this.resolveExit = r;
  });
  send(frame: Uint8Array): void {
    this.sent.push(frame);
    const f = decodeFrame(frame);
    if (f.op === OP_EXIT) this.resolveExit(f.code);
  }
  close(): void {
    this.readyState = 3;
  }
}

function run(argv: string[]): FakeWs {
  const ws = new FakeWs();
  attachExec(ws as unknown as WsWebSocket, {
    argv,
    cols: 80,
    rows: 24,
    cwd: process.cwd(),
    env: process.env,
    log: () => {},
  });
  return ws;
}

function output(ws: FakeWs): string {
  return ws.sent
    .map((f) => decodeFrame(f))
    .filter((f) => f.op === OP_OUTPUT)
    .map((f) => new TextDecoder().decode((f as { data: Uint8Array }).data))
    .join("");
}

describe("attachExec (PTY)", () => {
  it("streams stdout and relays the exit code", async () => {
    const ws = run(["sh", "-c", "printf hello; exit 0"]);
    expect(await ws.exited).toBe(0);
    expect(output(ws)).toContain("hello");
  });

  it("relays a non-zero exit code", async () => {
    const ws = run(["sh", "-c", "exit 7"]);
    expect(await ws.exited).toBe(7);
  });

  it("forwards stdin to the command", async () => {
    const ws = run(["sh", "-c", "read x; printf 'got-%s' \"$x\""]);
    ws.emit("message", Buffer.from(encodeDataFrame(OP_INPUT, "hi\n")));
    expect(await ws.exited).toBe(0);
    expect(output(ws)).toContain("got-hi");
  });

  it("reports a missing command as a non-zero exit", async () => {
    const ws = run(["definitely-not-a-real-cmd-xyz-42"]);
    expect(await ws.exited).toBeGreaterThan(0);
  });

  it("kills the command when the socket closes", async () => {
    const ws = run(["sleep", "30"]);
    ws.emit("close");
    expect(await ws.exited).toBeGreaterThanOrEqual(0);
  });
});
