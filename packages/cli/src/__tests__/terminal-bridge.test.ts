import { encodeDataFrame, encodeExit, OP_OUTPUT } from "api-server-api";
import { afterEach, describe, expect, it } from "vitest";
import type { WebSocket, WebSocketServer } from "ws";

import {
  connectTerminalBridge,
  TERMINAL_MODE_RESET,
} from "../modules/chat/infrastructure/terminal-bridge.js";
import {
  setTitle,
  TITLE_RESTORE,
  TITLE_SAVE,
} from "../modules/chat/infrastructure/terminal-title.js";
import {
  fakeStdin,
  fakeStdout,
  listenTerminal,
  type FakeStdout,
} from "./terminal-streams.js";

describe("connectTerminalBridge", () => {
  let wss: WebSocketServer | undefined;

  afterEach(() => {
    wss?.close();
    wss = undefined;
  });

  function listen(onConnection: (ws: WebSocket) => void): string {
    const server = listenTerminal(onConnection);
    wss = server.wss;
    return `${server.url}/term`;
  }

  function bridge(url: string, stdout: FakeStdout, title?: string) {
    return connectTerminalBridge({
      url,
      sessionId: "s-1",
      reconnectTo: async () => ({ kind: "stop", reason: "no reconnect" }),
      stdin: fakeStdin(),
      stdout,
      status: fakeStdout(),
      reconnectNotice: () => "reconnecting",
      policy: { backoffMs: [1], giveUpMs: 1_000 },
      title: title === undefined ? undefined : () => title,
    });
  }

  it("resets terminal modes after an abrupt disconnect", async () => {
    const url = listen((ws) => {
      ws.send(encodeDataFrame(OP_OUTPUT, "\x1b[?1003h\x1b[?1006h"), () =>
        ws.terminate(),
      );
    });

    const stdout = fakeStdout();
    const result = await bridge(url, stdout);

    expect(result.kind).toBe("disconnected");
    expect(stdout.captured().endsWith(TERMINAL_MODE_RESET)).toBe(true);
  });

  it("resets terminal modes after a clean exit", async () => {
    const url = listen((ws) => {
      ws.send(encodeExit(0));
    });

    const stdout = fakeStdout();
    const result = await bridge(url, stdout);

    expect(result).toEqual({ kind: "exited", code: 0, sessionId: "s-1" });
    expect(stdout.captured().endsWith(TERMINAL_MODE_RESET)).toBe(true);
  });

  it("forwards remote output to stdout before the reset", async () => {
    const url = listen((ws) => {
      ws.send(encodeDataFrame(OP_OUTPUT, "hello"));
      ws.send(encodeExit(0));
    });

    const stdout = fakeStdout();
    await bridge(url, stdout);

    expect(stdout.captured()).toBe(`hello${TERMINAL_MODE_RESET}`);
  });

  // TEST_SCENARIO: the harness sets its own window title as it starts. The bridge must keep its leave hint in the title for the whole connection, and give the user's own title back when it ends.
  it("holds its title over the remote's and restores the old one", async () => {
    const url = listen((ws) => {
      ws.send(encodeDataFrame(OP_OUTPUT, "a\x1b]0;Claude Code\x07b"));
      ws.send(encodeExit(0));
    });

    const stdout = fakeStdout();
    await bridge(url, stdout, "leave hint");

    expect(stdout.captured()).toBe(
      `${TITLE_SAVE}${setTitle("leave hint")}ab${TITLE_RESTORE}${TERMINAL_MODE_RESET}`,
    );
  });
});
