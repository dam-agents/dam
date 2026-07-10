import http from "node:http";
import { monitorEventLoopDelay } from "node:perf_hooks";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import headlessPkg from "@xterm/headless";
const { Terminal: HeadlessTerminal } = headlessPkg;
import serializePkg from "@xterm/addon-serialize";
const { SerializeAddon } = serializePkg;
import * as nodePty from "@lydell/node-pty";
import { WebSocketServer, type WebSocket as WsWebSocket } from "ws";
import { createHTTPHandler } from "@trpc/server/adapters/standalone";
import { appRouter } from "agent-runtime-api/router";
import type { AgentRuntimeContext } from "agent-runtime-api";
import {
  OP_INPUT,
  OP_OUTPUT,
  OP_RESIZE,
  decodeFrame,
  encodeDataFrame,
  encodeExit,
} from "api-server-api";
import { attachExec } from "./modules/exec.js";
import { mergedSpawnEnv } from "./core/runtime-env.js";
import { createFileDocumentStoreBackend } from "./core/document-store.js";
import { expandHome } from "./core/expand-home.js";
import { createFilesService } from "./modules/files.js";
import { createImportHandlers, sweepStaging } from "./modules/import/index.js";
import { composeSkills } from "./modules/skills/index.js";
import { configureGitCredentialHelper } from "./modules/git.js";
import { createPodServiceSupervisor } from "./modules/pod-service.js";
import { createSshService, prepareSshd, spawnSshd } from "./modules/ssh.js";
import { config } from "./modules/config.js";
import { composeAcp } from "./modules/acp/compose.js";
import { createWebSocketChannel } from "./modules/acp/infrastructure/create-websocket-channel.js";
import {
  composeRuntimeChannel,
  createEnvPlugin,
  createEnvStateStore,
  createFilePlugin,
  createMcpEntryPlugin,
  createSkillInstallPlugin,
} from "./modules/runtime-channel/index.js";
import {
  loadManifest,
  resolveDrivers,
  type RuntimeManifest,
} from "./modules/runtime-channel/manifest.js";

const __dir = dirname(fileURLToPath(import.meta.url));
const homeDir = config.PLATFORM_DEV
  ? join(__dir, "../working-dir")
  : config.HOME_DIR;
const workDir = config.PLATFORM_DEV
  ? join(__dir, "../working-dir")
  : config.WORK_DIR;

// Set on ephemeral `dam-run` executor pods (Run CR). Such a pod exists only to
// run one command over /api/exec: it exposes that endpoint and skips the
// runtime-channel hello (its narrow gateway SA can't reach that path anyway —
// credentials arrive via controller-injected env + on-wire gateway injection,
// exactly as for forks).
const EXEC_ONLY = process.env.PLATFORM_EXEC_ONLY === "1";

// skill-ref driver paths from the *resolved* manifest (the built-in default when
// the manifest doesn't declare skill-ref), $HOME expanded against home. Must
// match how composeRuntimeChannel resolves it — hence resolveDrivers, not the raw map.
function skillRefPaths(manifest: RuntimeManifest, home: string): string[] {
  const binding = resolveDrivers(manifest)["skill-ref"] as
    | { paths?: unknown }
    | undefined;
  const raw = Array.isArray(binding?.paths) ? binding.paths : [];
  return raw
    .filter((p): p is string => typeof p === "string")
    .map((p) => expandHome(p, home));
}

// Shared by the skills service (read side) and the skill-install driver.
const manifestPath = config.PLATFORM_DEV
  ? join(__dir, "../../platform-base/runtime-manifest.yaml")
  : join(__dir, "../runtime-manifest.yaml");
const runtimeManifest = loadManifest(manifestPath);

// Boot-time module composition. Skills + Files services are stable across the
// lifetime of the process; createContext just hands them out per-request.
const filesService = createFilesService(homeDir);
const skillsService = composeSkills({
  skillPaths: skillRefPaths(runtimeManifest, homeDir),
  log: (msg) => process.stderr.write(`[skills] ${msg}\n`),
});
const sshService = createSshService(homeDir);
const importHandlers = createImportHandlers(homeDir, workDir, (msg) =>
  process.stderr.write(`[import] ${msg}\n`),
);

const stateBackend = createFileDocumentStoreBackend(homeDir);

// Single shared env store: the env driver writes it; the spawn paths below
// (harness, terminal, ssh, git) read it through the RuntimeEnvReader port.
const envStore = createEnvStateStore(homeDir);

const podServicePath = "/usr/local/bin/pod-service";
const podLog = (msg: string) => process.stderr.write(`[pod-service] ${msg}\n`);
const podService = existsSync(podServicePath)
  ? createPodServiceSupervisor({
      command: podServicePath,
      stateBackend,
      envReader: envStore,
      log: podLog,
    })
  : null;

if (envStore.ready()) podService?.refreshEnv();

const { runtime: acpRuntime, triggerDriver } = composeAcp({
  command: config.PLATFORM_DEV
    ? ["npx", "-y", "@agentclientprotocol/claude-agent-acp"]
    : ["/usr/local/bin/harness-chat"],
  workingDir: workDir,
  stateBackend,
  envReader: envStore,
  log: (msg) => process.stderr.write(`[acp] ${msg}\n`),
});

const runtimeChannel = await composeRuntimeChannel({
  manifestPath,
  agentHome: homeDir,
  workDir,
  stateBackend,
  apiServerUrl: config.API_SERVER_URL,
  agentId: process.env.PLATFORM_AGENT_ID ?? process.env.HOSTNAME ?? "unknown",
  triggerDriver,
  envReader: envStore,
  plugins: [
    createEnvPlugin({
      store: envStore,
      onChange: () => {
        acpRuntime.refreshEnv();
        podService?.refreshEnv();
        configureGitCredentialHelper(envStore, (msg) =>
          process.stderr.write(`[git] ${msg}\n`),
        );
      },
    }),
    createFilePlugin(),
    createMcpEntryPlugin(),
    createSkillInstallPlugin({ install: skillsService.install }),
  ],
});

const preparedSshd = await prepareSshd(homeDir, (msg) =>
  process.stderr.write(`[ssh] ${msg}\n`),
);

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

// 70 MB upload headroom: file-uploads go through files.upload as base64
// (≈1.34× overhead) plus JSON wrapping. The server-side FilesService caps
// decoded payloads at 50 MB, so this is purely a transport-layer guard that
// prevents partial reads before the service-level check kicks in.
const TRPC_MAX_BODY_SIZE = 70 * 1024 * 1024;

// The agent's NetworkPolicy admits ingress on this port only from the
// api-server and controller pods; the api-server has already verified
// the user JWT and agent ownership before forwarding. So tRPC routes
// need no in-process auth check — the kernel-level gate is the auth
// boundary.
const trpcHandler = createHTTPHandler({
  router: appRouter,
  createContext: (): AgentRuntimeContext => ({
    files: filesService,
    skills: skillsService,
    ssh: sshService,
    runtime: runtimeChannel.service,
    harnessConfig: runtimeChannel.harnessConfig,
  }),
  maxBodySize: TRPC_MAX_BODY_SIZE,
});

// A detached PTY is reaped on harness quietness, not viewer loss, so in-flight
// work survives switching away. The grace stays short for tab-refresh reattach.
const PTY_DETACH_GRACE_MS = 30_000;
const PTY_IDLE_REAP_MS = 5 * 60_000;

interface PtySlot {
  pty: nodePty.IPty | null;
  headless: InstanceType<typeof HeadlessTerminal>;
  serialize: InstanceType<typeof SerializeAddon>;
  client: WsWebSocket | null;
  graceTimer: ReturnType<typeof setTimeout> | null;
  lastOutputAt: number;
}

const ptySlots = new Map<string, PtySlot>();
const ptyLog = (sid: string, msg: string) =>
  process.stderr.write(`[pty] [${sid}] ${msg}\n`);

function killPtySlot(sessionId: string): void {
  const slot = ptySlots.get(sessionId);
  if (!slot) return;
  if (slot.graceTimer) clearTimeout(slot.graceTimer);
  try {
    slot.pty?.kill();
  } catch {}
  slot.headless.dispose();
  ptySlots.delete(sessionId);
  ptyLog(sessionId, "killed");
}

function reapPtySlotIfIdle(sessionId: string): void {
  const slot = ptySlots.get(sessionId);
  if (!slot || slot.client || !slot.pty) return;
  const quietMs = Date.now() - slot.lastOutputAt;
  if (quietMs >= PTY_IDLE_REAP_MS) {
    killPtySlot(sessionId);
    return;
  }
  slot.graceTimer = setTimeout(
    () => reapPtySlotIfIdle(sessionId),
    PTY_IDLE_REAP_MS - quietMs,
  );
}

function attachPty(
  sessionId: string,
  ws: WsWebSocket,
  opts: { reset: boolean },
): void {
  if (opts.reset) killPtySlot(sessionId);
  let initialized = false;
  ws.binaryType = "nodebuffer";

  // An errored socket may never emit close; both paths must arm the reap timer.
  const detach = () => {
    const slot = ptySlots.get(sessionId);
    if (!slot || slot.client !== ws) return;
    slot.client = null;
    if (!slot.pty) return;
    if (slot.graceTimer) clearTimeout(slot.graceTimer);
    slot.graceTimer = setTimeout(
      () => reapPtySlotIfIdle(sessionId),
      PTY_DETACH_GRACE_MS,
    );
  };
  ws.on("error", detach);
  ws.on("close", detach);

  ws.on("message", (raw: Buffer) => {
    let frame;
    try {
      frame = decodeFrame(raw);
    } catch {
      return;
    }

    if (!initialized) {
      if (frame.op !== OP_RESIZE) {
        ws.close(1002, "first frame must be RESIZE");
        return;
      }
      initialized = true;
      const { cols, rows } = frame;

      const existing = ptySlots.get(sessionId);
      if (existing) {
        if (existing.graceTimer) clearTimeout(existing.graceTimer);
        if (
          existing.client &&
          existing.client !== ws &&
          existing.client.readyState === 1
        ) {
          existing.client.close(1000, "replaced by new connection");
        }
        existing.client = ws;
        existing.headless.resize(cols, rows);
        existing.pty?.resize(cols, rows);
        const serialized = existing.serialize.serialize();
        if (serialized.length > 0)
          ws.send(encodeDataFrame(OP_OUTPUT, serialized));
        return;
      }

      const headless = new HeadlessTerminal({
        cols,
        rows,
        scrollback: 1000,
        allowProposedApi: true,
      });
      const serialize = new SerializeAddon();
      headless.loadAddon(serialize);
      const pty = nodePty.spawn("/usr/local/bin/harness-terminal", [], {
        name: "xterm-256color",
        cols,
        rows,
        cwd: workDir,
        env: {
          // Runtime-channel env first; process.env wins on collision.
          ...envStore.current(),
          ...(Object.fromEntries(
            Object.entries(process.env).filter(
              ([k, v]) =>
                v !== undefined &&
                !k.startsWith("npm_config_") &&
                !k.startsWith("npm_lifecycle_"),
            ),
          ) as Record<string, string>),
          TERM: "xterm-256color",
          COLORTERM: "truecolor",
          HARNESS_SESSION_ID: sessionId,
        },
      });
      const slot: PtySlot = {
        pty,
        headless,
        serialize,
        client: ws,
        graceTimer: null,
        lastOutputAt: Date.now(),
      };
      ptySlots.set(sessionId, slot);
      ptyLog(sessionId, `spawned PTY (${cols}x${rows})`);

      pty.onData((data) => {
        slot.lastOutputAt = Date.now();
        slot.headless.write(data);
        if (slot.client?.readyState === 1)
          slot.client.send(encodeDataFrame(OP_OUTPUT, data));
      });
      pty.onExit(({ exitCode }) => {
        ptyLog(sessionId, `exited ${exitCode}`);
        if (slot.graceTimer) clearTimeout(slot.graceTimer);
        if (slot.client?.readyState === 1) {
          slot.client.send(encodeExit(exitCode));
          slot.client.close(1000, "pty exited");
        }
        slot.pty = null;
        slot.headless.dispose();
        ptySlots.delete(sessionId);
      });
      return;
    }

    const slot = ptySlots.get(sessionId);
    if (!slot) return;
    if (frame.op === OP_INPUT) {
      slot.pty?.write(new TextDecoder().decode(frame.data));
    } else if (frame.op === OP_RESIZE) {
      slot.headless.resize(frame.cols, frame.rows);
      slot.pty?.resize(frame.cols, frame.rows);
    }
  });
}

const server = http.createServer((req, res) => {
  if (req.method === "OPTIONS") {
    res.writeHead(204, CORS).end();
    return;
  }

  if (req.url === "/healthz") {
    res.writeHead(200, { "Content-Type": "text/plain" }).end("ok");
    return;
  }

  if (req.url === "/api/status") {
    const status = {
      idle: acpRuntime.status().idle && ptySlots.size === 0,
    };
    res
      .writeHead(200, { "Content-Type": "application/json", ...CORS })
      .end(JSON.stringify(status));
    return;
  }

  if (req.method === "POST" && req.url === "/api/import") {
    void importHandlers.handleImport(req, res);
    return;
  }

  const sessionResetMatch =
    req.method === "POST" &&
    req.url?.match(/^\/api\/sessions\/([^/]+)\/reset$/);
  if (sessionResetMatch) {
    acpRuntime.resetSession(decodeURIComponent(sessionResetMatch[1]!));
    res.writeHead(204, CORS).end();
    return;
  }

  if (req.url?.startsWith("/api/trpc")) {
    req.url = req.url.replace("/api/trpc", "");
    Object.entries(CORS).forEach(([k, v]) => res.setHeader(k, v));
    trpcHandler(req, res);
    return;
  }

  res.writeHead(404).end();
});

const acpWss = new WebSocketServer({ noServer: true });
const termWss = new WebSocketServer({ noServer: true });
const sshWss = new WebSocketServer({ noServer: true });
const execWss = new WebSocketServer({ noServer: true });

acpWss.on("connection", (ws) => {
  acpRuntime.attach(createWebSocketChannel(ws));
});

server.on("upgrade", (req, socket, head) => {
  const url = new URL(req.url!, `http://${req.headers.host}`);
  if (url.pathname === "/api/acp") {
    acpWss.handleUpgrade(req, socket, head, (ws) =>
      acpWss.emit("connection", ws, req),
    );
  } else if (url.pathname === "/api/terminal") {
    const sessionId = url.searchParams.get("sessionId") ?? "default";
    const reset = url.searchParams.get("reset") === "1";
    termWss.handleUpgrade(req, socket, head, (ws) =>
      attachPty(sessionId, ws, { reset }),
    );
  } else if (url.pathname === "/api/ssh") {
    if (!preparedSshd) {
      socket.destroy();
      return;
    }
    sshWss.handleUpgrade(req, socket, head, (ws) =>
      spawnSshd(ws, preparedSshd, envStore, (msg) =>
        process.stderr.write(`[ssh] ${msg}\n`),
      ),
    );
  } else if (url.pathname === "/api/exec" && EXEC_ONLY) {
    // argv (+ cwd / tty size) arrive as query on the upgrade URL, forwarded
    // verbatim by the api-server relay from the dam-run caller. The command is
    // never persisted in the Run CR — it lives only on this connection.
    const q = url.searchParams;
    let argv: unknown;
    try {
      argv = JSON.parse(
        Buffer.from(q.get("argv") ?? "", "base64").toString("utf8"),
      );
    } catch {
      socket.destroy();
      return;
    }
    if (
      !Array.isArray(argv) ||
      argv.length === 0 ||
      !argv.every((a): a is string => typeof a === "string")
    ) {
      socket.destroy();
      return;
    }
    // Caller's W3C trace context, forwarded by dam-run: the command joins the
    // spawning session's trace, so its telemetry folds into that session's
    // metrics.
    const traceparent = q.get("traceparent");
    const tracestate = q.get("tracestate");
    execWss.handleUpgrade(req, socket, head, (ws) =>
      attachExec(ws, {
        argv,
        cols: Number(q.get("cols")) || 80,
        rows: Number(q.get("rows")) || 24,
        cwd: q.get("cwd") || workDir,
        env: {
          ...mergedSpawnEnv(envStore),
          ...(traceparent ? { TRACEPARENT: traceparent } : {}),
          ...(tracestate ? { TRACESTATE: tracestate } : {}),
        },
        log: (msg) => process.stderr.write(`[exec] ${msg}\n`),
      }),
    );
  } else {
    socket.destroy();
  }
});

// Node defaults `requestTimeout` to 5 minutes. The import route holds a
// request open through extract+finalize of a multi-GB tar — easily over
// the default on slow uploads. `server.requestTimeout` is an absolute
// timer set at request start (not socket-idle) so there's no public Node
// API to scope it per-handler; disable it server-wide instead.
//
// What's lost: the body-read timeout on every other route. What still
// protects them:
//   - `headersTimeout = 60s` bounds the headers phase on every route.
//   - Non-import routes have hard body caps (TRPC_MAX_BODY_SIZE = 32 MB),
//     so a slow body ties up a TCP connection but can't grow memory.
//   - This server is reachable only from the api-server pod
//     (NetworkPolicy), so the slow-body actor would have to be the
//     trusted api-server itself.
// The import handler installs its own inactivity (30s) + wall-clock
// (30min) deadlines, so stuck imports still get aborted.
server.requestTimeout = 0;
server.headersTimeout = 60_000;

server.listen(config.PORT, () => {
  process.stderr.write(`Platform on http://localhost:${config.PORT}\n`);

  void sweepStaging(homeDir, (msg) =>
    process.stderr.write(`[import] ${msg}\n`),
  );

  if (!EXEC_ONLY) {
    void runtimeChannel.helloOnBoot({
      agentRuntimeVersion:
        process.env.PLATFORM_AGENT_VERSION ?? "agent-runtime/unknown",
    });
  }
});

// cgroup memory accounting is whole-container (agent-runtime + harness +
// pod-service), so it catches pressure from the harness even when this
// process's own heap is fine. cgroupfs reads are kernel-served (no disk I/O),
// so a sync read here can't itself stall the loop. v2 path, v1 fallback.
function readCgroupBytes(v2: string, v1: string): number | null {
  for (const p of [v2, v1]) {
    try {
      const raw = readFileSync(p, "utf8").trim();
      if (raw === "max") return Infinity;
      const n = Number.parseInt(raw, 10);
      if (Number.isFinite(n)) return n;
    } catch {
      // try next path / give up
    }
  }
  return null;
}

// Event-loop block watchdog. /healthz shares this single thread, so a long
// synchronous stall is what trips the liveness probe and gets the pod
// SIGKILLed. Each block is logged with memory + CPU context so the cause is
// self-evident next time without guessing:
//   - GC thrash        → heap≈heapTotal, high cpu%
//   - container memory  → cgroup near limit, low cpu% (harness is a separate
//     pressure            process under the same cgroup; our own heap stays normal)
//   - CPU-bound sync op → high cpu%, heap + cgroup normal
//   - blocking syscall  → low cpu%, heap + cgroup normal
// A gated [mem] heartbeat captures the run-up to a memory-pressure collapse,
// since a terminal wedge leaves no time to log on its own. monitorEventLoopDelay
// samples at libuv level so a recoverable block is captured; a terminal wedge
// still can't self-report (the kubelet event is the signal there).
const mib = (n: number) => Math.round(n / 1_048_576);
const cgMax = readCgroupBytes(
  "/sys/fs/cgroup/memory.max",
  "/sys/fs/cgroup/memory/memory.limit_in_bytes",
);
const haveLimit = cgMax !== null && Number.isFinite(cgMax) && cgMax < 1e15;
const eld = monitorEventLoopDelay({ resolution: 20 });
eld.enable();
let prevCpu = process.cpuUsage();
let prevAt = Date.now();
setInterval(() => {
  try {
    const maxMs = eld.max / 1e6;
    const p99Ms = eld.percentile(99) / 1e6;
    eld.reset();
    const cpu = process.cpuUsage(prevCpu);
    prevCpu = process.cpuUsage();
    const now = Date.now();
    const wallMs = Math.max(1, now - prevAt);
    prevAt = now;
    const cpuPct = Math.round(((cpu.user + cpu.system) / 1000 / wallMs) * 100);
    const mu = process.memoryUsage();
    const cgCur = readCgroupBytes(
      "/sys/fs/cgroup/memory.current",
      "/sys/fs/cgroup/memory/memory.usage_in_bytes",
    );
    const cgStr =
      cgCur !== null
        ? ` cgroup=${mib(cgCur)}${haveLimit ? "/" + mib(cgMax as number) : ""}MB`
        : "";
    const memStr = `rss=${mib(mu.rss)}MB heap=${mib(mu.heapUsed)}/${mib(mu.heapTotal)}MB cpu=${cpuPct}%${cgStr}`;
    if (maxMs >= 1_000) {
      process.stderr.write(
        `[eventloop] blocked up to ${Math.round(maxMs)}ms (p99 ${Math.round(p99Ms)}ms) in last 10s — ${memStr}\n`,
      );
    } else if (
      haveLimit &&
      cgCur !== null &&
      cgCur / (cgMax as number) >= 0.85
    ) {
      process.stderr.write(`[mem] high cgroup usage — ${memStr}\n`);
    }
  } catch {
    // observability must never take down the runtime
  }
}, 10_000).unref();

let shuttingDown = false;
function gracefulShutdown(signal: string): void {
  if (shuttingDown) return;
  shuttingDown = true;
  process.stderr.write(`[shutdown] ${signal} received, closing\n`);
  server.close();
  for (const sid of [...ptySlots.keys()]) killPtySlot(sid);
  acpRuntime.shutdown();
  setTimeout(() => process.exit(0), 3_000).unref();
}
process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));
