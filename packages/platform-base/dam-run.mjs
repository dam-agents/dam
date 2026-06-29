#!/usr/bin/env node
// dam-run — run a command in a fresh, separate sandbox pod that shares this
// pod's image, configuration, and RWX /home/agent volume. Stdio is streamed
// through a PTY so it reads like a local invocation; the executor pod dies when
// this process exits.
//
// Dependency-free: uses Node's global WebSocket (which honors NODE_USE_ENV_PROXY
// + NODE_EXTRA_CA_CERTS already set in the agent env, so it routes through the
// paired gateway and trusts Envoy's CA). The WHATWG WebSocket can't set request
// headers, so args ride the URL query; the api-server relay forwards them to the
// executor's /api/exec.

// Frame opcodes — must match packages/api-server-api/src/modules/terminal/protocol.ts.
const OP_INPUT = 0x00;
const OP_OUTPUT = 0x01;
const OP_RESIZE = 0x02;
const OP_EXIT = 0x03;

const argv = process.argv.slice(2);
if (argv.length === 0) {
  process.stderr.write("usage: dam-run <command> [args...]\n");
  process.exit(2);
}

const mcpUrl = process.env.PLATFORM_MCP_URL;
if (!mcpUrl || !/\/mcp$/.test(mcpUrl)) {
  process.stderr.write("dam-run: PLATFORM_MCP_URL not set; not inside a sandbox pod?\n");
  process.exit(1);
}
const runUrl =
  mcpUrl.replace(/\/mcp$/, "/run").replace(/^http/, "ws") +
  "?argv=" +
  encodeURIComponent(Buffer.from(JSON.stringify(argv)).toString("base64")) +
  "&cwd=" +
  encodeURIComponent(process.cwd()) +
  `&cols=${process.stdout.columns || 80}&rows=${process.stdout.rows || 24}`;

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
  process.exit(code);
};

const send = (frame) => {
  if (ws.readyState === WebSocket.OPEN) ws.send(frame);
};
const resizeFrame = () => {
  const c = process.stdout.columns || 80;
  const r = process.stdout.rows || 24;
  return new Uint8Array([OP_RESIZE, (c >> 8) & 0xff, c & 0xff, (r >> 8) & 0xff, r & 0xff]);
};

ws.onopen = () => {
  send(resizeFrame());
  if (isTty) {
    process.stdin.setRawMode(true);
    process.stdout.on("resize", () => send(resizeFrame()));
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
    process.stderr.write(`dam-run: ${ev.reason}\n`);
  }
  finish(1); // a close without a prior OP_EXIT is a failure
};
ws.onerror = () => {
  if (!exited) process.stderr.write("dam-run: connection failed\n");
  finish(1);
};

// Closing the socket makes the api-server delete the Run, reaping the executor.
// In a tty, Ctrl-C reaches the remote PTY as input via raw mode instead.
const SIGNUM = { SIGHUP: 1, SIGINT: 2, SIGTERM: 15 };
for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(sig, () => {
    try {
      ws.close();
    } catch {}
    finish(128 + SIGNUM[sig]); // shell convention: 130/143/129
  });
}
