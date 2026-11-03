import WebSocket from "ws";
import {
  decodeFrame,
  DEFAULT_RECONNECT_POLICY,
  encodeDataFrame,
  encodeResize,
  OP_EXIT,
  OP_INPUT,
  OP_OUTPUT,
  OP_SESSION,
  planReconnect,
  type ReconnectClock,
  type ReconnectPolicy,
  type TerminalDrop,
} from "api-server-api";

import { proxyAgentForUrl } from "../../shared/ws-proxy.js";
import {
  createTitleFilter,
  setTitle,
  TITLE_RESTORE,
  TITLE_SAVE,
} from "./terminal-title.js";

export type BridgeResult =
  | { kind: "exited"; code: number; sessionId: string }
  | { kind: "disconnected"; reason: string; sessionId: string };

export type ReconnectTarget =
  | { kind: "connect"; url: string }
  | { kind: "wait"; reason: string }
  | { kind: "stop"; reason: string };

export interface ReconnectNotice {
  reason: string;
  attempt: number;
  delayMs: number;
}

export const TERMINAL_MODE_RESET =
  "\x1b[<u" +
  "\x1b[?1049l" +
  "\x1b[?1000;1002;1003;1005;1006;1015;1016l" +
  "\x1b[?1004l" +
  "\x1b[?2004l" +
  "\x1b[?25h" +
  "\x1b[0m";

export const CLEAR_SCREEN = "\x1b[H\x1b[2J\x1b[3J";

export const KEEPALIVE_SILENCE_MS = 75_000;

const CTRL_C = 0x03;

type Stdin = NodeJS.ReadStream & { setRawMode?(mode: boolean): void };

interface ConnectionEnd {
  drop: TerminalDrop;
  live: boolean;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: pipes the local terminal to one terminal Session
 * over the relay, across lost connections. When a connection that carried
 * frames drops and `planReconnect` says to retry, the bridge
 * resets the terminal's modes, shows the reconnect notice, and connects again
 * to the Session it last saw (the harness can move its PTY to a new Session
 * with an OP_SESSION frame) at the shared backoff steps. Each attempt asks
 * `reconnectTo` for its URL, so the token is fresh. The screen is cleared just
 * before the first frame of a new connection, because the runtime starts each
 * attach with a replay of the screen and scrollback. While it reconnects, stdin
 * is still raw and nothing is sent, so Ctrl+C arrives as the byte 0x03 and
 * stops the attempts. A connection that has had pings and then gets none for
 * `keepaliveSilenceMs` counts as lost, because a dead network path can leave
 * the socket open with no error.
 */
export async function connectTerminalBridge(options: {
  url: string;
  sessionId: string;
  reconnectTo: (sessionId: string) => Promise<ReconnectTarget>;
  stdin: Stdin;
  stdout: NodeJS.WriteStream;
  status: NodeJS.WritableStream;
  reconnectNotice: (notice: ReconnectNotice) => string;
  title?: (sessionId: string) => string;
  policy?: ReconnectPolicy;
  keepaliveSilenceMs?: number;
  now?: () => number;
}): Promise<BridgeResult> {
  const { stdin, stdout, title } = options;
  const policy = options.policy ?? DEFAULT_RECONNECT_POLICY;
  const silenceMs = options.keepaliveSilenceMs ?? KEEPALIVE_SILENCE_MS;
  const now = options.now ?? Date.now;
  const filter = title === undefined ? undefined : createTitleFilter();

  let sessionId = options.sessionId;
  let socket: WebSocket | null = null;
  let reconnecting = false;
  let inputStarted = false;
  let titleShown = false;
  let cancel!: () => void;
  const cancelled = new Promise<"cancelled">((resolve) => {
    cancel = () => resolve("cancelled");
  });

  const onData = (chunk: Buffer) => {
    if (reconnecting) {
      if (chunk.includes(CTRL_C)) cancel();
      return;
    }
    if (socket?.readyState === WebSocket.OPEN)
      socket.send(encodeDataFrame(OP_INPUT, new Uint8Array(chunk)));
  };
  const onResize = () => {
    if (socket?.readyState === WebSocket.OPEN)
      socket.send(encodeResize(stdout.columns, stdout.rows));
  };

  const startInput = () => {
    if (inputStarted) return;
    inputStarted = true;
    if (stdin.setRawMode) stdin.setRawMode(true);
    stdin.resume();
    stdin.on("data", onData);
    process.on("SIGWINCH", onResize);
  };

  const connect = (url: string, afterDrop: boolean) =>
    new Promise<ConnectionEnd>((resolve) => {
      const ws = new WebSocket(url, { agent: proxyAgentForUrl(url) });
      socket = ws;
      let live = false;
      let exitCode: number | null = null;
      let refusedStatus: number | null = null;
      let lostReason: string | null = null;
      let silence: NodeJS.Timeout | undefined;

      ws.on("unexpected-response", (_req, res) => {
        refusedStatus = res.statusCode ?? 0;
        ws.terminate();
      });

      ws.on("open", () => {
        if (title !== undefined && !titleShown) {
          titleShown = true;
          stdout.write(TITLE_SAVE + setTitle(title(sessionId)));
        }
        ws.send(encodeResize(stdout.columns, stdout.rows));
        startInput();
      });

      ws.on("ping", () => {
        clearTimeout(silence);
        silence = setTimeout(() => {
          lostReason = `no keepalive from the server for ${Math.round(silenceMs / 1000)} s`;
          ws.terminate();
        }, silenceMs);
      });

      ws.on("message", (data: Buffer) => {
        let frame;
        try {
          frame = decodeFrame(new Uint8Array(data));
        } catch {
          return;
        }
        if (!live) {
          live = true;
          if (afterDrop) {
            reconnecting = false;
            stdout.write(CLEAR_SCREEN);
          }
        }
        if (frame.op === OP_OUTPUT)
          stdout.write(filter ? filter(frame.data) : Buffer.from(frame.data));
        else if (frame.op === OP_SESSION) {
          sessionId = frame.sessionId;
          if (titleShown && title !== undefined)
            stdout.write(setTitle(title(sessionId)));
        } else if (frame.op === OP_EXIT) {
          exitCode = frame.code;
          ws.close();
        }
      });

      ws.on("error", (e) => {
        lostReason ??= e.message;
      });

      ws.on("close", (code, reason) => {
        clearTimeout(silence);
        const drop: TerminalDrop =
          exitCode !== null
            ? { kind: "exited", code: exitCode }
            : refusedStatus !== null
              ? { kind: "refused", status: refusedStatus }
              : code === 1006
                ? { kind: "lost", reason: lostReason ?? "connection lost" }
                : { kind: "closed", code, reason: reason.toString() };
        resolve({ drop, live });
      });
    });

  const waitFor = (ms: number) => {
    let timer: NodeJS.Timeout | undefined;
    const elapsed = new Promise<"elapsed">((resolve) => {
      timer = setTimeout(() => resolve("elapsed"), ms);
    });
    return Promise.race([elapsed, cancelled]).finally(() =>
      clearTimeout(timer),
    );
  };

  const finish = (result: BridgeResult): BridgeResult => {
    stdin.off("data", onData);
    process.off("SIGWINCH", onResize);
    if (inputStarted) {
      if (stdin.setRawMode)
        try {
          stdin.setRawMode(false);
        } catch {}
      stdin.pause();
    }
    if (titleShown) stdout.write(TITLE_RESTORE);
    stdout.write(TERMINAL_MODE_RESET);
    const ws = socket as WebSocket | null;
    if (
      ws?.readyState === WebSocket.OPEN ||
      ws?.readyState === WebSocket.CONNECTING
    )
      ws.terminate();
    return result;
  };
  const disconnected = (reason: string) =>
    finish({ kind: "disconnected", reason, sessionId });

  let end = await connect(options.url, false);
  let everLive = end.live;
  let clock: ReconnectClock = { attempt: 0, since: now() };
  for (;;) {
    const { drop } = end;
    if (drop.kind === "exited")
      return finish({ kind: "exited", code: drop.code, sessionId });
    const step = planReconnect({
      drop,
      everLive,
      live: end.live,
      clock,
      now: now(),
      policy,
    });
    if (step.kind === "end") return disconnected(step.reason);
    clock = step.clock;
    reconnecting = true;
    stdout.write(TERMINAL_MODE_RESET);
    options.status.write(
      `\x1b[2J\x1b[H${options.reconnectNotice({
        reason: step.reason,
        attempt: clock.attempt,
        delayMs: step.delayMs,
      })}\n`,
    );

    if ((await waitFor(step.delayMs)) === "cancelled")
      return disconnected("reconnect cancelled");
    const target = await Promise.race([
      options.reconnectTo(sessionId),
      cancelled,
    ]);
    if (target === "cancelled") return disconnected("reconnect cancelled");
    if (target.kind === "stop") return disconnected(target.reason);
    if (target.kind === "wait") {
      end = { drop: { kind: "lost", reason: target.reason }, live: false };
      continue;
    }
    const next = await Promise.race([connect(target.url, true), cancelled]);
    if (next === "cancelled") return disconnected("reconnect cancelled");
    end = next;
    everLive ||= end.live;
  }
}
