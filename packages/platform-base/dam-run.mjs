#!/usr/bin/env node
// dam-run / dam-vm — one script, two install names (mode = invoked name).
//   dam-run <cmd>: run a command in a fresh, separate sandbox pod that shares
//     this pod's image, configuration, and RWX /home/agent volume. The
//     executor pod dies when this process exits.
//   dam-vm [cmd]: run a command in this agent's Incus container on the
//     deployment's VM host (packages/dam-vm) — a root-capable machine with its
//     own filesystem that shares nothing with this pod: no credentials, no
//     workspace, cwd /root. No argv → interactive login shell. The container
//     survives across invocations while in active use but is deleted after
//     ~1 h idle — an ephemeral machine, not durable storage.
// Both ride the same rails: derive the harness URL from PLATFORM_MCP_URL, open
// one WebSocket (/run or /vm), and stream stdio via the shared frame protocol.
// Interactive invocations get a remote PTY (reads like a local shell);
// non-interactive dam-vm runs raw (no PTY) so e.g. `dam-vm cat x > x` preserves
// binary output instead of getting terminal (CRLF) translation applied.
//
// Dependency-free: uses Node's global WebSocket (which honors NODE_USE_ENV_PROXY
// + NODE_EXTRA_CA_CERTS already set in the agent env, so it routes through the
// paired gateway and trusts Envoy's CA). The WHATWG WebSocket can't set request
// headers, so args ride the URL query; the api-server relay forwards them.
import { basename } from "node:path";

// Frame opcodes 0x00–0x03 match packages/api-server-api/src/modules/terminal/protocol.ts.
const OP_INPUT = 0x00;
const OP_OUTPUT = 0x01;
const OP_RESIZE = 0x02;
const OP_EXIT = 0x03;
// dam-vm-only extensions for the non-interactive (no-PTY) path, so binary
// stdout survives redirection: stderr is a separate stream, and stdin EOF is a
// real close (a PTY has neither). The /vm relay splices frames byte-for-byte,
// so only the CLI and dam-vm-server need to agree on these.
const OP_STDERR = 0x04;
const OP_EOF = 0x05;

const NAME = basename(process.argv[1], ".mjs"); // dam-run | dam-vm
const IS_VM = NAME === "dam-vm";

const argv = process.argv.slice(2);
if (argv.length === 0 && !IS_VM) {
  process.stderr.write("usage: dam-run <command> [args...]\n");
  process.exit(2);
}

const mcpUrl = process.env.PLATFORM_MCP_URL;
if (!mcpUrl || !/\/mcp$/.test(mcpUrl)) {
  process.stderr.write(`${NAME}: PLATFORM_MCP_URL not set; not inside a sandbox pod?\n`);
  process.exit(1);
}

// Allocate a remote PTY only when interactive. dam-vm additionally requires
// stdout to be a terminal, so `dam-vm cat x > x` runs without a PTY and binary
// output survives redirection (no CRLF translation); dam-run keeps its
// stdin-only heuristic since its executor always uses a PTY.
const interactive = IS_VM
  ? Boolean(process.stdin.isTTY && process.stdout.isTTY)
  : Boolean(process.stdin.isTTY);

const runUrl =
  mcpUrl.replace(/\/mcp$/, IS_VM ? "/vm" : "/run").replace(/^http/, "ws") +
  "?argv=" +
  encodeURIComponent(Buffer.from(JSON.stringify(argv)).toString("base64")) +
  // no cwd for the VM: its filesystem is its own, commands run in /root
  (IS_VM ? "" : "&cwd=" + encodeURIComponent(process.cwd())) +
  `&cols=${process.stdout.columns || 80}&rows=${process.stdout.rows || 24}` +
  `&tty=${interactive ? 1 : 0}` +
  // Forward the caller's W3C trace context (the harness sets TRACEPARENT for
  // its subprocesses) so the remote command joins the session's trace and
  // its telemetry folds into the session's metrics.
  (process.env.TRACEPARENT
    ? `&traceparent=${encodeURIComponent(process.env.TRACEPARENT)}`
    : "") +
  (process.env.TRACESTATE
    ? `&tracestate=${encodeURIComponent(process.env.TRACESTATE)}`
    : "");

const ws = new WebSocket(runUrl);
ws.binaryType = "arraybuffer";

let exited = false;
const finish = (code) => {
  if (exited) return;
  exited = true;
  if (interactive) {
    try {
      process.stdin.setRawMode(false);
    } catch {}
  }
  process.stdin.pause();
  // Flush stdout before exiting — process.exit truncates a backpressured
  // pipe. The timer is a backstop for a wedged stdout consumer.
  process.stdout.write("", () => process.exit(code));
  setTimeout(() => process.exit(code), 2000);
};

// The relay completes the upgrade before it dials the remote target, so a slow
// handshake means the path to the api-server is broken, not a slow executor
// pod / cold container (those show up as post-open silence instead).
const dialTimeout = setTimeout(() => {
  process.stderr.write(`${NAME}: timed out connecting to the platform relay\n`);
  finish(1);
}, 30_000);

const send = (frame) => {
  if (ws.readyState === WebSocket.OPEN) ws.send(frame);
};
const resizeFrame = () => {
  const c = process.stdout.columns || 80;
  const r = process.stdout.rows || 24;
  return new Uint8Array([OP_RESIZE, (c >> 8) & 0xff, c & 0xff, (r >> 8) & 0xff, r & 0xff]);
};

ws.onopen = () => {
  clearTimeout(dialTimeout);
  send(resizeFrame());
  if (interactive) {
    process.stdin.setRawMode(true);
    process.stdout.on("resize", () => send(resizeFrame()));
  } else {
    // Non-interactive stdin end → EOF. dam-vm runs raw (no PTY) so close its
    // stdin for real; dam-run's executor uses a PTY (no true EOF), so signal
    // it the terminal way with EOT — twice, since the first only flushes a
    // partial line (the command reads the 0x04 bytes as data, as in a tty).
    process.stdin.on("end", () =>
      send(
        IS_VM
          ? new Uint8Array([OP_EOF])
          : new Uint8Array([OP_INPUT, 0x04, 0x04]),
      ),
    );
  }
  process.stdin.on("data", (chunk) => {
    const frame = new Uint8Array(chunk.length + 1);
    frame[0] = OP_INPUT;
    frame.set(chunk, 1);
    send(frame);
  });
  process.stdin.resume();
};

ws.onmessage = (ev) => {
  const buf = new Uint8Array(ev.data);
  if (buf.length === 0) return;
  if (buf[0] === OP_OUTPUT) process.stdout.write(buf.subarray(1));
  else if (buf[0] === OP_STDERR) process.stderr.write(buf.subarray(1));
  // finish() exits the process; no need to close the socket
  else if (buf[0] === OP_EXIT) finish(buf.length > 1 ? buf[1] : 0);
};

ws.onclose = (ev) => {
  if (!exited && ev.code !== 1000 && ev.reason) {
    process.stderr.write(`${NAME}: ${ev.reason}\n`);
  }
  finish(1); // a close without a prior OP_EXIT is a failure
};
ws.onerror = () => {
  if (!exited) process.stderr.write(`${NAME}: connection failed\n`);
  finish(1);
};

// Closing the socket tears down the remote side: dam-run's Run CR is deleted,
// reaping the executor; dam-vm's incus exec ends (the container stays up for
// the next call). In a tty, Ctrl-C reaches the remote PTY as input instead.
const SIGNUM = { SIGHUP: 1, SIGINT: 2, SIGTERM: 15 };
for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(sig, () => {
    try {
      ws.close();
    } catch {}
    finish(128 + SIGNUM[sig]); // shell convention: 130/143/129
  });
}
