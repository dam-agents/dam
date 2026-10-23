// TEST_OVERVIEW: `dam chat` against a local WebSocket server that plays the terminal relay. After a connection that carried frames drops for a transient reason, the bridge connects again to the same Session with a fresh URL from `reconnectTo`, clears the screen before the replay, and keeps the terminal raw so Ctrl+C stops the attempts; a drop that ends the Session, or one before the first frame, ends the attach as before.
import {
  encodeDataFrame,
  encodeExit,
  OP_INPUT,
  OP_OUTPUT,
  OP_SESSION,
  decodeFrame,
} from "api-server-api";
import { afterEach, describe, expect, it } from "vitest";
import type { WebSocket, WebSocketServer } from "ws";

import {
  CLEAR_SCREEN,
  connectTerminalBridge,
  type ReconnectTarget,
} from "../modules/chat/infrastructure/terminal-bridge.js";
import {
  fakeStdin,
  fakeStdout,
  listenTerminal,
  type FakeStdin,
} from "./terminal-streams.js";

const FAST = { backoffMs: [5], giveUpMs: 10_000 };

let servers: WebSocketServer[] = [];

afterEach(() => {
  for (const wss of servers) wss.close();
  servers = [];
});

function relay(
  onConnection: (ws: WebSocket, nth: number, url: string) => void,
) {
  let count = 0;
  const server = listenTerminal((ws, url) => onConnection(ws, count++, url));
  servers.push(server.wss);
  return server;
}

function attach(
  url: string,
  options: {
    stdin?: FakeStdin;
    reconnectTo?: (sessionId: string) => Promise<ReconnectTarget>;
    policy?: { backoffMs: number[]; giveUpMs: number };
    keepaliveSilenceMs?: number;
  } = {},
) {
  const stdout = fakeStdout();
  const status = fakeStdout();
  const asked: string[] = [];
  const result = connectTerminalBridge({
    url: `${url}/attach?reset=1`,
    sessionId: "s-1",
    reconnectTo:
      options.reconnectTo ??
      (async (sessionId) => {
        asked.push(sessionId);
        return {
          kind: "connect",
          url: `${url}/reconnect?sessionId=${sessionId}&token=t${asked.length + 1}`,
        };
      }),
    stdin: options.stdin ?? fakeStdin(),
    stdout,
    status,
    reconnectNotice: ({ reason, attempt }) =>
      `reconnecting #${attempt}: ${reason}`,
    policy: options.policy ?? FAST,
    keepaliveSilenceMs: options.keepaliveSilenceMs,
  });
  return { result, stdout, status, asked };
}

describe("dam chat reconnect", () => {
  // TEST_SCENARIO: the network drops while Claude sits at its prompt. The CLI must reach the same Session again without the user doing anything, with a fresh token and without reset=1, and the replay of the screen must land on a cleared screen rather than under the old one.
  it("reconnects to the same session and clears the screen before the replay", async () => {
    const urls: string[] = [];
    const { url } = relay((ws, nth, path) => {
      urls.push(path);
      if (nth === 0)
        ws.send(encodeDataFrame(OP_OUTPUT, "before"), () => ws.terminate());
      else {
        ws.send(encodeDataFrame(OP_OUTPUT, "replay"));
        ws.send(encodeExit(0));
      }
    });

    const { result, stdout, status, asked } = attach(url);

    expect(await result).toEqual({ kind: "exited", code: 0, sessionId: "s-1" });
    expect(asked).toEqual(["s-1"]);
    expect(urls).toEqual([
      "/attach?reset=1",
      "/reconnect?sessionId=s-1&token=t2",
    ]);
    expect(status.captured()).toContain("reconnecting #1");
    const out = stdout.captured();
    expect(out.indexOf(CLEAR_SCREEN)).toBeGreaterThan(out.indexOf("before"));
    expect(out.indexOf("replay")).toBeGreaterThan(out.indexOf(CLEAR_SCREEN));
  });

  // TEST_SCENARIO: the harness moved its PTY to a new Session (Claude Code's /clear) before the drop. The reconnect and the resume command must name the new Session, or the CLI would start a second harness on the old one.
  it("follows a session the harness moved to", async () => {
    const { url } = relay((ws, nth) => {
      if (nth === 0)
        ws.send(encodeDataFrame(OP_SESSION, "s-2"), () => ws.terminate());
      else ws.send(encodeExit(0));
    });

    const { result, asked } = attach(url);

    expect(await result).toEqual({ kind: "exited", code: 0, sessionId: "s-2" });
    expect(asked).toEqual(["s-2"]);
  });

  it.each([
    ["a newer viewer superseded it", 1000, "superseded"],
    ["the PTY exited", 1000, "pty exited"],
    ["the agent was put to sleep", 1011, "agent not ready: stopped"],
    ["the lease was refused", 1008, "provider-removed"],
  ])("does not reconnect when %s", async (_, code, reason) => {
    const { url } = relay((ws) => {
      ws.send(encodeDataFrame(OP_OUTPUT, "x"), () => ws.close(code, reason));
    });

    const { result, asked } = attach(url);

    expect(await result).toEqual({
      kind: "disconnected",
      reason,
      sessionId: "s-1",
    });
    expect(asked).toEqual([]);
  });

  // TEST_SCENARIO: the first connect fails before any frame arrives, as when the agent cannot be reached at all. That is not a drop of a working Session, so the CLI reports it at once as it did before reconnect existed.
  it("does not reconnect a first connection that never carried a frame", async () => {
    const { url } = relay((ws) => ws.terminate());

    const { result, asked } = attach(url);

    expect((await result).kind).toBe("disconnected");
    expect(asked).toEqual([]);
  });

  it("reconnects after a relay that goes away", async () => {
    const { url } = relay((ws, nth) => {
      if (nth === 0)
        ws.send(encodeDataFrame(OP_OUTPUT, "x"), () =>
          ws.close(1001, "server shutting down"),
        );
      else ws.send(encodeExit(3));
    });

    const { result } = attach(url);

    expect(await result).toEqual({ kind: "exited", code: 3, sessionId: "s-1" });
  });

  // TEST_SCENARIO: a dead network path can leave the socket open with no error. Once the relay's pings stop, the CLI must treat the connection as lost and reconnect, instead of hanging until TCP gives up.
  it("reconnects when the relay's pings stop", async () => {
    const { url } = relay((ws, nth) => {
      if (nth === 0) {
        ws.ping();
        ws.send(encodeDataFrame(OP_OUTPUT, "x"));
      } else ws.send(encodeExit(0));
    });

    const { result, status } = attach(url, { keepaliveSilenceMs: 50 });

    expect(await result).toEqual({ kind: "exited", code: 0, sessionId: "s-1" });
    expect(status.captured()).toContain("no keepalive from the server");
  });

  // TEST_SCENARIO: stdin stays raw while the CLI reconnects, so Ctrl+C is the byte 0x03, not a signal. It must stop the attempts and end the attach, also while a new connection is open but the relay still waits for the agent, and the keys typed meanwhile must not reach the harness.
  it("stops reconnecting on Ctrl+C and drops other keys", async () => {
    const received: string[] = [];
    let waiting: WebSocket | undefined;
    const server = relay((ws, nth) => {
      ws.on("message", (data: Buffer) => {
        const frame = decodeFrame(new Uint8Array(data));
        if (frame.op === OP_INPUT)
          received.push(Buffer.from(frame.data).toString());
      });
      if (nth === 0)
        ws.send(encodeDataFrame(OP_OUTPUT, "x"), () => ws.terminate());
      else waiting = ws;
    });
    const stdin = fakeStdin();

    const { result } = attach(server.url, { stdin });
    while (!waiting) await new Promise((r) => setTimeout(r, 5));
    stdin.write("typed while away");
    await new Promise((r) => setTimeout(r, 20));
    stdin.write("\x03");

    expect(await result).toEqual({
      kind: "disconnected",
      reason: "reconnect cancelled",
      sessionId: "s-1",
    });
    expect(received).toEqual([]);
  });

  it("sends keys again once the new connection carries frames", async () => {
    const server = relay((ws, nth) => {
      if (nth === 0) {
        ws.send(encodeDataFrame(OP_OUTPUT, "x"), () => ws.terminate());
        return;
      }
      ws.on("message", (data: Buffer) => {
        const frame = decodeFrame(new Uint8Array(data));
        if (frame.op === OP_INPUT) ws.send(encodeExit(7));
      });
      ws.send(encodeDataFrame(OP_OUTPUT, "replay"));
    });
    const stdin = fakeStdin();

    const { result, stdout } = attach(server.url, { stdin });
    while (!stdout.captured().includes("replay"))
      await new Promise((r) => setTimeout(r, 5));
    stdin.write("hi");

    expect(await result).toEqual({ kind: "exited", code: 7, sessionId: "s-1" });
  });

  it("stops on Ctrl+C while it waits between attempts", async () => {
    const server = relay((ws, nth) => {
      if (nth === 0)
        ws.send(encodeDataFrame(OP_OUTPUT, "x"), () => ws.terminate());
      else ws.terminate();
    });
    const stdin = fakeStdin();

    const { result, status } = attach(server.url, {
      stdin,
      policy: { backoffMs: [5, 60_000], giveUpMs: 120_000 },
    });
    while (!status.captured().includes("reconnecting #2"))
      await new Promise((r) => setTimeout(r, 5));
    const pressed = Date.now();
    stdin.write("\x03");

    expect((await result).kind).toBe("disconnected");
    expect(Date.now() - pressed).toBeLessThan(1_000);
  });

  it("gives up once the give-up time has passed", async () => {
    const { url } = relay((ws, nth) => {
      if (nth === 0)
        ws.send(encodeDataFrame(OP_OUTPUT, "x"), () => ws.terminate());
      else ws.terminate();
    });

    const { result } = attach(url, {
      policy: { backoffMs: [10], giveUpMs: 100 },
    });

    const end = await result;
    expect(end.kind).toBe("disconnected");
    expect(end.kind === "disconnected" && end.reason).toMatch(
      /^could not reconnect within 0 s: /,
    );
  });

  // TEST_SCENARIO: the sign-in must be refreshed for every attempt. A refresh that fails on the network is tried again with the connection; a refresh the identity provider refuses ends the attach with its reason.
  it("waits out a failed token refresh and stops on a refused one", async () => {
    const { url } = relay((ws) => {
      ws.send(encodeDataFrame(OP_OUTPUT, "x"), () => ws.terminate());
    });
    const targets: ReconnectTarget[] = [
      { kind: "wait", reason: "refresh failed" },
      { kind: "stop", reason: "session expired" },
    ];
    let asked = 0;

    const { result } = attach(url, {
      reconnectTo: async () => targets[asked++]!,
    });

    expect(await result).toEqual({
      kind: "disconnected",
      reason: "session expired",
      sessionId: "s-1",
    });
    expect(asked).toBe(2);
  });
});
