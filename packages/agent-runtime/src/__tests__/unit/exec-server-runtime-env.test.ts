import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import WebSocket from "ws";
import { OP_OUTPUT, OP_EXIT, decodeFrame } from "api-server-api";

// Boots the real server in exec-only mode (the `dam-run` executor pod shape)
// and asserts a command run over /api/exec sees the runtime-channel env — the
// rail that carries the agent-telemetry OTEL_* config (observability.md). This
// is what makes `dam-run claude -p ...` (and its subshells) export telemetry;
// a regression here (e.g. spawning with bare process.env) breaks it silently.

const pkgRoot = join(dirname(fileURLToPath(import.meta.url)), "../../..");
// PLATFORM_DEV=true pins HOME_DIR/WORK_DIR to working-dir/ (gitignored) and
// the manifest to platform-base's — the only boot mode that works from source.
const homeDir = join(pkgRoot, "working-dir");
const PORT = 18099;
const MARKER = "https://collector.test.invalid:4318";

let server: ChildProcess;

async function connectExec(argv: string[], extra = ""): Promise<WebSocket> {
  const url =
    `ws://127.0.0.1:${PORT}/api/exec?argv=` +
    encodeURIComponent(Buffer.from(JSON.stringify(argv)).toString("base64")) +
    `&cwd=${encodeURIComponent(homeDir)}&cols=80&rows=24` +
    extra;
  for (let i = 0; i < 100; i++) {
    try {
      return await new Promise<WebSocket>((resolve, reject) => {
        const ws = new WebSocket(url);
        ws.once("open", () => resolve(ws));
        ws.once("error", reject);
      });
    } catch {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  throw new Error("server never became reachable");
}

function runToExit(ws: WebSocket): Promise<{ out: string; code: number }> {
  return new Promise((resolve, reject) => {
    let out = "";
    ws.on("message", (raw: Buffer) => {
      const f = decodeFrame(raw);
      if (f.op === OP_OUTPUT) out += new TextDecoder().decode(f.data);
      else if (f.op === OP_EXIT) resolve({ out, code: f.code });
    });
    ws.on("error", reject);
  });
}

beforeAll(() => {
  mkdirSync(join(homeDir, ".platform"), { recursive: true });
  writeFileSync(
    join(homeDir, ".platform", "runtime-env.json"),
    JSON.stringify({ env: { OTEL_EXPORTER_OTLP_ENDPOINT: MARKER } }),
  );
  const tsxCli = createRequire(import.meta.url).resolve("tsx/cli");
  server = spawn(process.execPath, [tsxCli, "src/server.ts"], {
    cwd: pkgRoot,
    env: {
      ...process.env,
      PLATFORM_EXEC_ONLY: "1",
      PLATFORM_DEV: "true",
      PORT: String(PORT),
      // Composed at boot but never dialed: exec-only skips the hello.
      API_SERVER_URL: "http://127.0.0.1:1",
      OTEL_EXPORTER_OTLP_ENDPOINT: undefined,
    },
    stdio: ["ignore", "ignore", "inherit"],
  });
});

afterAll(() => {
  server?.kill();
  rmSync(join(homeDir, ".platform"), { recursive: true, force: true });
});

describe("/api/exec (dam-run executor)", () => {
  it("spawns commands with the runtime-channel env (telemetry rail)", async () => {
    const ws = await connectExec([
      "sh",
      "-c",
      'printf "endpoint=%s" "$OTEL_EXPORTER_OTLP_ENDPOINT"',
    ]);
    const { out, code } = await runToExit(ws);
    expect(code).toBe(0);
    expect(out).toContain(`endpoint=${MARKER}`);
  }, 30_000);

  it("passes the dam-run caller's trace context to the command", async () => {
    const tp = "00-11111111111111111111111111111111-2222222222222222-01";
    const ws = await connectExec(
      ["sh", "-c", 'printf "tp=%s" "$TRACEPARENT"'],
      `&traceparent=${encodeURIComponent(tp)}`,
    );
    const { out, code } = await runToExit(ws);
    expect(code).toBe(0);
    expect(out).toContain(`tp=${tp}`);
  }, 30_000);
});
