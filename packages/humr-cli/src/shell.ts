/**
 * POC `humr` CLI shell (dam-wn6).
 *
 * Connects the local terminal to a Humr instance pod's TUI:
 *   stdin → WS binary frame  → pod stdin via `tmux new -A -s humr claude`
 *   pod stdout → WS binary frame → local stdout
 *   SIGWINCH  → WS text frame `{type:"resize", cols, rows}`
 *
 * Usage:
 *   HUMR_API_BASE=ws://humr-api.localhost:4444 \
 *   HUMR_SHELL_SECRET=dev-shell-secret \
 *   tsx src/shell.ts <instanceId>
 *
 * Reconnect: closing the local CLI does not kill tmux inside the pod.
 * Re-running the same command lands in the same TUI.
 */
import WebSocket from "ws";

const apiBase = process.env.HUMR_API_BASE ?? "ws://humr-api.localhost:4444";
const secret = process.env.HUMR_SHELL_SECRET;
const instanceId = process.argv[2];

if (!instanceId) {
  process.stderr.write("usage: humr-cli shell <instanceId>\n");
  process.exit(2);
}
if (!secret) {
  process.stderr.write("HUMR_SHELL_SECRET is not set\n");
  process.exit(2);
}

const url = `${apiBase.replace(/\/$/, "")}/api/instances/${encodeURIComponent(instanceId)}/shell`;

const stdin = process.stdin;
const stdout = process.stdout;

if (!stdin.isTTY || !stdout.isTTY) {
  process.stderr.write("humr-cli shell requires a TTY\n");
  process.exit(2);
}

const ws = new WebSocket(url, {
  headers: { Authorization: `Bearer ${secret}` },
});

let restored = false;
function restoreTty() {
  if (restored) return;
  restored = true;
  try { stdin.setRawMode(false); } catch { /* noop */ }
  stdin.pause();
}

function fail(reason: string, code = 1): never {
  restoreTty();
  process.stderr.write(`\nhumr-cli shell: ${reason}\n`);
  process.exit(code);
}

ws.on("open", () => {
  stdin.setRawMode(true);
  stdin.resume();

  sendResize();
  process.on("SIGWINCH", sendResize);

  stdin.on("data", (chunk: Buffer) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(chunk, { binary: true });
  });
});

function sendResize() {
  if (ws.readyState !== WebSocket.OPEN) return;
  const cols = stdout.columns ?? 80;
  const rows = stdout.rows ?? 24;
  ws.send(JSON.stringify({ type: "resize", cols, rows }));
}

ws.on("message", (data, isBinary) => {
  if (!isBinary) return;
  const buf = data instanceof Buffer
    ? data
    : Array.isArray(data)
      ? Buffer.concat(data)
      : Buffer.from(data as ArrayBuffer);
  stdout.write(buf);
});

ws.on("close", (code, reason) => {
  restoreTty();
  if (code === 1000) {
    process.exit(0);
  }
  process.stderr.write(`\nshell closed (${code}) ${reason.toString()}\n`);
  process.exit(code === 1006 ? 1 : 0);
});

ws.on("error", (err) => {
  fail(`websocket error: ${err.message}`);
});

process.on("exit", restoreTty);
process.on("SIGTERM", () => { restoreTty(); process.exit(0); });
process.on("SIGHUP", () => { restoreTty(); process.exit(0); });
