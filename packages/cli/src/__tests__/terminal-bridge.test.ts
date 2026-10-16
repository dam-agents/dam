import { PassThrough } from "node:stream";
import { encodeDataFrame, encodeExit, OP_OUTPUT } from "api-server-api";
import { afterEach, describe, expect, it } from "vitest";
import { WebSocketServer } from "ws";

import {
  connectTerminalBridge,
  TERMINAL_MODE_RESET,
} from "../modules/chat/infrastructure/terminal-bridge.js";
import {
  setTitle,
  TITLE_RESTORE,
  TITLE_SAVE,
} from "../modules/chat/infrastructure/terminal-title.js";

type FakeStdin = NodeJS.ReadStream & { setRawMode?(mode: boolean): void };
type FakeStdout = NodeJS.WriteStream & { captured(): string };

function fakeStdin(): FakeStdin {
  return Object.assign(new PassThrough(), {
    setRawMode: () => {},
  }) as unknown as FakeStdin;
}

function fakeStdout(): FakeStdout {
  const chunks: Buffer[] = [];
  const stream = new PassThrough() as unknown as FakeStdout;
  stream.columns = 80;
  stream.rows = 24;
  stream.on("data", (chunk: Buffer) => chunks.push(chunk));
  stream.captured = () => Buffer.concat(chunks).toString("utf8");
  return stream;
}

describe("connectTerminalBridge", () => {
  let wss: WebSocketServer | undefined;

  afterEach(() => {
    wss?.close();
    wss = undefined;
  });

  function listen(onConnection: (ws: import("ws").WebSocket) => void): string {
    wss = new WebSocketServer({ port: 0 });
    wss.on("connection", onConnection);
    const { port } = wss.address() as { port: number };
    return `http://127.0.0.1:${port}`;
  }

  it("resets terminal modes after an abrupt disconnect", async () => {
    const host = listen((ws) => {
      ws.send(encodeDataFrame(OP_OUTPUT, "\x1b[?1003h\x1b[?1006h"), () =>
        ws.terminate(),
      );
    });

    const stdout = fakeStdout();
    const result = await connectTerminalBridge({
      host,
      token: "t",
      terminalPath: "/term",
      stdin: fakeStdin(),
      stdout,
    });

    expect(result.kind).toBe("disconnected");
    expect(stdout.captured().endsWith(TERMINAL_MODE_RESET)).toBe(true);
  });

  it("resets terminal modes after a clean exit", async () => {
    const host = listen((ws) => {
      ws.send(encodeExit(0));
    });

    const stdout = fakeStdout();
    const result = await connectTerminalBridge({
      host,
      token: "t",
      terminalPath: "/term",
      stdin: fakeStdin(),
      stdout,
    });

    expect(result).toEqual({ kind: "exited", code: 0 });
    expect(stdout.captured().endsWith(TERMINAL_MODE_RESET)).toBe(true);
  });

  it("forwards remote output to stdout before the reset", async () => {
    const host = listen((ws) => {
      ws.send(encodeDataFrame(OP_OUTPUT, "hello"));
      ws.send(encodeExit(0));
    });

    const stdout = fakeStdout();
    await connectTerminalBridge({
      host,
      token: "t",
      terminalPath: "/term",
      stdin: fakeStdin(),
      stdout,
    });

    expect(stdout.captured()).toBe(`hello${TERMINAL_MODE_RESET}`);
  });

  // TEST_SCENARIO: the harness sets its own window title as it starts. The bridge must keep its leave hint in the title for the whole connection, and give the user's own title back when it ends.
  it("holds its title over the remote's and restores the old one", async () => {
    const host = listen((ws) => {
      ws.send(encodeDataFrame(OP_OUTPUT, "a\x1b]0;Claude Code\x07b"));
      ws.send(encodeExit(0));
    });

    const stdout = fakeStdout();
    await connectTerminalBridge({
      host,
      token: "t",
      terminalPath: "/term",
      stdin: fakeStdin(),
      stdout,
      title: "leave hint",
    });

    expect(stdout.captured()).toBe(
      `${TITLE_SAVE}${setTitle("leave hint")}ab${TITLE_RESTORE}${TERMINAL_MODE_RESET}`,
    );
  });
});
