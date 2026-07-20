#!/usr/bin/env node
// dam-vm — run a command in this agent's Incus container on the deployment's
// VM host. Same frame protocol and PTY behavior as dam-run, but the target is
// a root-capable machine with its own filesystem instead of an ephemeral
// executor pod sharing this pod's image and workspace.
//
// Rides the same rails as dam-run: derives the harness URL from
// PLATFORM_MCP_URL and opens one WebSocket to /api/agents/<id>/vm; the
// api-server relays the stream to the VM host, attaching the deployment API
// key and this agent's waypoint-proven identity. This pod holds no VM
// credential and never names its container.
//
// Differences from dam-run:
//   - no cwd forwarding: the container has its own filesystem; commands run
//     in /root. No argv → interactive login shell.
//   - the container survives across invocations while in active use, but the
//     VM host deletes it after ~1h idle — treat it as an ephemeral machine,
//     not durable storage.

// Frame opcodes — must match packages/api-server-api/src/modules/terminal/protocol.ts.
const OP_INPUT = 0x00;
const OP_OUTPUT = 0x01;
const OP_RESIZE = 0x02;
const OP_EXIT = 0x03;

const argv = process.argv.slice(2);

const mcpUrl = process.env.PLATFORM_MCP_URL;
if (!mcpUrl || !/\/mcp$/.test(mcpUrl)) {
  process.stderr.write("dam-vm: PLATFORM_MCP_URL not set; not inside a sandbox pod?\n");
  process.exit(1);
}
const runUrl =
  mcpUrl.replace(/\/mcp$/, "/vm").replace(/^http/, "ws") +
  "?argv=" +
  encodeURIComponent(Buffer.from(JSON.stringify(argv)).toString("base64")) +
  `&cols=${process.stdout.columns || 80}&rows=${process.stdout.rows || 24}` +
  // Forward the caller's W3C trace context (the harness sets TRACEPARENT for
  // its subprocesses) so the VM command joins the session's trace.
  (process.env.TRACEPARENT
    ? `&traceparent=${encodeURIComponent(process.env.TRACEPARENT)}`
    : "") +
  (process.env.TRACESTATE
    ? `&tracestate=${encodeURIComponent(process.env.TRACESTATE)}`
    : "");

const ws = new WebSocket(runUrl);
ws.binaryType = "arraybuffer";
const isTty = Boolean(process.stdin.isTTY);

let exited = false;
const finish = (code) => {
  if (exited) return;
  exited = true;
  if (isTty) {
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

// The relay completes the upgrade before it dials the VM host, so a slow
// handshake means the path to the api-server is broken, not a cold container
// (that shows up as post-open silence instead).
const dialTimeout = setTimeout(() => {
  process.stderr.write("dam-vm: timed out connecting to the platform relay\n");
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
  if (isTty) {
    process.stdin.setRawMode(true);
    process.stdout.on("resize", () => send(resizeFrame()));
  } else {
    // Piped stdin: a PTY has no true EOF, so signal it the terminal way, with
    // EOT — twice, since the first only flushes a partial line (a raw-mode
    // command would read the 0x04 bytes as data, same as in a real terminal).
    process.stdin.on("end", () => send(new Uint8Array([OP_INPUT, 0x04, 0x04])));
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
  // finish() exits the process; no need to close the socket
  else if (buf[0] === OP_EXIT) finish(buf.length > 1 ? buf[1] : 0);
};

ws.onclose = (ev) => {
  if (!exited && ev.code !== 1000 && ev.reason) {
    process.stderr.write(`dam-vm: ${ev.reason}\n`);
  }
  finish(1); // a close without a prior OP_EXIT is a failure
};
ws.onerror = () => {
  if (!exited) process.stderr.write("dam-vm: connection failed\n");
  finish(1);
};

// Closing the socket ends the incus exec on the VM host; the container stays
// up for the next call. In a tty, Ctrl-C reaches the remote PTY as input.
const SIGNUM = { SIGHUP: 1, SIGINT: 2, SIGTERM: 15 };
for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(sig, () => {
    try {
      ws.close();
    } catch {}
    finish(128 + SIGNUM[sig]); // shell convention: 130/143/129
  });
}
