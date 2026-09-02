import http from "node:http";
import { monitorEventLoopDelay } from "node:perf_hooks";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import headlessPkg from "@xterm/headless";
const { Terminal: HeadlessTerminal } = headlessPkg;
import serializePkg from "@xterm/addon-serialize";
const { SerializeAddon } = serializePkg;
import * as nodePty from "@lydell/node-pty";
import { WebSocketServer, type WebSocket as WsWebSocket } from "ws";
import { createHTTPHandler } from "@trpc/server/adapters/standalone";
import { applyWSSHandler } from "@trpc/server/adapters/ws";
import { appRouter } from "agent-runtime-api/router";
import {
  AGENT_HOME_DIR,
  AGENT_WORK_DIR,
  STAGED_SKILLS_DIR,
  backgroundWorkReportSchema,
  type AgentRuntimeContext,
} from "agent-runtime-api";
import {
  OP_INPUT,
  OP_OUTPUT,
  OP_RESIZE,
  decodeFrame,
  encodeDataFrame,
  encodeExit,
} from "api-server-api";
import { mergedSpawnEnv } from "./core/runtime-env.js";
import { createFileDocumentStoreBackend } from "./core/document-store.js";
import { expandHome } from "./core/expand-home.js";
import { createFilesService } from "./modules/files.js";
import { composeKbPublish } from "./modules/kb-publish/compose.js";
import { createHarnessClient } from "./modules/runtime-channel/harness-client.js";
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
  createArtifactTouchReporter,
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
  : AGENT_HOME_DIR;
const workDir = config.PLATFORM_DEV
  ? join(__dir, "../working-dir")
  : AGENT_WORK_DIR;

try {
  mkdirSync(workDir, { recursive: true });
} catch (err) {
  process.stderr.write(
    `[server] could not create workDir ${workDir}: ${(err as Error).message}\n`,
  );
}

function skillRefPaths(manifest: RuntimeManifest, home: string): string[] {
  const binding = resolveDrivers(manifest)["skill-ref"] as
    | { paths?: unknown }
    | undefined;
  const raw = Array.isArray(binding?.paths) ? binding.paths : [];
  return raw
    .filter((p): p is string => typeof p === "string")
    .map((p) => expandHome(p, home));
}

const manifestPath = config.PLATFORM_DEV
  ? join(__dir, "../../platform-base/runtime-manifest.yaml")
  : join(__dir, "../runtime-manifest.yaml");
const runtimeManifest = loadManifest(manifestPath);

const platformAgentId =
  process.env.PLATFORM_AGENT_ID ?? process.env.HOSTNAME ?? "unknown";

const filesService = createFilesService(homeDir);
const harnessClient = createHarnessClient({
  apiServerUrl: config.API_SERVER_URL,
  agentId: platformAgentId,
});

const kbPublish = composeKbPublish({
  workDir,
  homeDir,
  harness: harnessClient,
  log: (msg) => process.stderr.write(`[kb-publish] ${msg}\n`),
});
const readSidePaths = skillRefPaths(runtimeManifest, homeDir);
const readSideSet = new Set(readSidePaths);
const pristineSkillPaths = [
  ...skillRefPaths(runtimeManifest, config.IMAGE_WORKSPACE_DIR).filter(
    (p) => !readSideSet.has(p),
  ),
  STAGED_SKILLS_DIR,
];
const skillsService = composeSkills({
  skillPaths: readSidePaths,
  pristineSkillPaths,
  log: (msg) => process.stderr.write(`[skills] ${msg}\n`),
});
const sshService = createSshService(homeDir);
const importHandlers = createImportHandlers(homeDir, workDir, (msg) =>
  process.stderr.write(`[import] ${msg}\n`),
);

const artifactTouchReporter = createArtifactTouchReporter({
  client: harnessClient,
  log: (msg) => process.stderr.write(`[artifact-touch] ${msg}\n`),
});

const stateBackend = createFileDocumentStoreBackend(homeDir);

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

process.env.PLATFORM_RUNTIME_URL = `http://127.0.0.1:${config.PORT}`;

const {
  runtime: acpRuntime,
  triggerDriver,
  sessionMetadata,
  backgroundWork,
  sessions: sessionsService,
  sessionChanges,
} = composeAcp({
  command: config.PLATFORM_DEV
    ? ["npx", "-y", "@agentclientprotocol/claude-agent-acp"]
    : ["/usr/local/bin/harness-chat"],
  workingDir: workDir,
  stateBackend,
  envReader: envStore,
  sessionHistory: runtimeManifest.sessionHistory,
  isTerminalSessionActive: isPtySessionActive,
  backgroundWorkHolds: config.BACKGROUND_WORK_HOLDS,
  onArtifactTouch: artifactTouchReporter.report,
  log: (msg) => process.stderr.write(`[acp] ${msg}\n`),
});

const runtimeChannel = await composeRuntimeChannel({
  manifestPath,
  agentHome: homeDir,
  workDir,
  stateBackend,
  apiServerUrl: config.API_SERVER_URL,
  agentId: platformAgentId,
  triggerDriver,
  envReader: envStore,
  plugins: [
    createEnvPlugin({
      store: envStore,
      onChange: ({ namesChanged }) => {
        acpRuntime.refreshEnv({ force: namesChanged });
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

const TRPC_MAX_BODY_SIZE = 70 * 1024 * 1024;

const createTrpcContext = (): AgentRuntimeContext => ({
  files: filesService,
  kbPublish: kbPublish.service,
  sessions: sessionsService,
  skills: skillsService,
  ssh: sshService,
  runtime: runtimeChannel.service,
  harnessConfig: runtimeChannel.harnessConfig,
});

const trpcHandler = createHTTPHandler({
  router: appRouter,
  createContext: createTrpcContext,
  maxBodySize: TRPC_MAX_BODY_SIZE,
});

const PTY_DETACH_GRACE_MS = 30_000;
const PTY_IDLE_REAP_MS = 5 * 60_000;
const PTY_ACTIVE_WINDOW_MS = 5_000;
const PTY_INPUT_ECHO_MS = 500;

function isPtySessionActive(sessionId: string): boolean {
  const slot = ptySlots.get(sessionId);
  return !!slot?.pty && Date.now() - slot.lastBusyAt < PTY_ACTIVE_WINDOW_MS;
}

interface PtySlot {
  pty: nodePty.IPty | null;
  headless: InstanceType<typeof HeadlessTerminal>;
  serialize: InstanceType<typeof SerializeAddon>;
  client: WsWebSocket | null;
  graceTimer: ReturnType<typeof setTimeout> | null;
  lastOutputAt: number;
  lastSeenStampAt: number;
  lastBusyAt: number;
  lastInputAt: number;
  sawInput: boolean;
}

const ptySlots = new Map<string, PtySlot>();
const ptyLog = (sid: string, msg: string) =>
  process.stderr.write(`[pty] [${sid}] ${msg}\n`);

const PTY_LIVENESS_SWEEP_MS = 1_000;
const ptyLiveness = new Set<string>();
let ptyLivenessTimer: NodeJS.Timeout | undefined;

function sweepPtyLiveness(): void {
  let changed = false;
  for (const sessionId of ptySlots.keys()) {
    const active = isPtySessionActive(sessionId);
    if (active === ptyLiveness.has(sessionId)) continue;
    if (active) ptyLiveness.add(sessionId);
    else ptyLiveness.delete(sessionId);
    changed = true;
  }
  for (const sessionId of [...ptyLiveness]) {
    if (ptySlots.has(sessionId)) continue;
    ptyLiveness.delete(sessionId);
    changed = true;
  }
  if (changed) sessionChanges.notify();
}

sessionChanges.onDemand({
  start: () => {
    if (ptyLivenessTimer) return;
    ptyLivenessTimer = setInterval(sweepPtyLiveness, PTY_LIVENESS_SWEEP_MS);
    ptyLivenessTimer.unref?.();
  },
  stop: () => {
    if (ptyLivenessTimer) clearInterval(ptyLivenessTimer);
    ptyLivenessTimer = undefined;
    ptyLiveness.clear();
  },
});

const PTY_SEEN_STAMP_DEBOUNCE_MS = 30_000;

function markTerminalSeen(sessionId: string): void {
  if (sessionMetadata.get(sessionId)) sessionMetadata.recordSeen(sessionId);
  else sessionMetadata.set(sessionId, { mode: "terminal" });
}

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

  const detach = () => {
    const slot = ptySlots.get(sessionId);
    if (!slot || slot.client !== ws) return;
    slot.client = null;
    markTerminalSeen(sessionId);
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
        markTerminalSeen(sessionId);
        existing.lastInputAt = Date.now();
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
        lastSeenStampAt: Date.now(),
        lastBusyAt: 0,
        lastInputAt: 0,
        sawInput: false,
      };
      ptySlots.set(sessionId, slot);
      ptyLog(sessionId, `spawned PTY (${cols}x${rows})`);
      markTerminalSeen(sessionId);

      pty.onData((data) => {
        const now = Date.now();
        slot.lastOutputAt = now;
        if (slot.sawInput && now - slot.lastInputAt > PTY_INPUT_ECHO_MS)
          slot.lastBusyAt = now;
        if (
          slot.client &&
          now - slot.lastSeenStampAt > PTY_SEEN_STAMP_DEBOUNCE_MS
        ) {
          slot.lastSeenStampAt = now;
          markTerminalSeen(sessionId);
        }
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
      const now = Date.now();
      slot.lastInputAt = now;
      slot.sawInput = true;
      const text = new TextDecoder().decode(frame.data);
      if (/[\r\n]/.test(text)) slot.lastBusyAt = now;
      slot.pty?.write(text);
    } else if (frame.op === OP_RESIZE) {
      slot.lastInputAt = Date.now();
      slot.headless.resize(frame.cols, frame.rows);
      slot.pty?.resize(frame.cols, frame.rows);
    }
  });
}

async function readJsonBody(req: http.IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of req) {
    const buf = chunk as Buffer;
    bytes += buf.length;
    if (bytes > 64 * 1024) throw new Error("body too large");
    chunks.push(buf);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
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
    const acp = acpRuntime.status();
    const status = {
      idle: acp.idle && ptySlots.size === 0 && !kbPublish.isBusy(),
      backgroundWork: acp.backgroundWork,
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

  const backgroundWorkMatch =
    req.method === "POST" &&
    req.url?.match(/^\/api\/sessions\/([^/]+)\/background-work$/);
  if (backgroundWorkMatch) {
    void readJsonBody(req)
      .then((body) => {
        const parsed = backgroundWorkReportSchema.safeParse(body);
        if (!parsed.success) {
          res
            .writeHead(400, { "Content-Type": "application/json", ...CORS })
            .end(JSON.stringify({ error: parsed.error.message }));
          return;
        }
        backgroundWork.report(
          decodeURIComponent(backgroundWorkMatch[1]!),
          parsed.data.items,
        );
        res.writeHead(204, CORS).end();
      })
      .catch((err: unknown) => {
        res
          .writeHead(400, { "Content-Type": "application/json", ...CORS })
          .end(JSON.stringify({ error: String(err) }));
      });
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
const trpcWss = new WebSocketServer({ noServer: true });

applyWSSHandler({
  wss: trpcWss,
  router: appRouter,
  createContext: createTrpcContext,
});

acpWss.on("connection", (ws, req: http.IncomingMessage) => {
  const passive =
    new URL(req.url ?? "", "http://localhost").searchParams.get("passive") ===
    "1";
  acpRuntime.attach(createWebSocketChannel(ws), { viewer: !passive });
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
  } else if (url.pathname === "/api/trpc-ws") {
    trpcWss.handleUpgrade(req, socket, head, (ws) =>
      trpcWss.emit("connection", ws, req),
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
  } else {
    socket.destroy();
  }
});

server.requestTimeout = 0;
server.headersTimeout = 60_000;

server.listen(config.PORT, () => {
  process.stderr.write(`Platform on http://localhost:${config.PORT}\n`);

  void sweepStaging(homeDir, (msg) =>
    process.stderr.write(`[import] ${msg}\n`),
  );

  void runtimeChannel.helloOnBoot({
    agentRuntimeVersion:
      process.env.PLATFORM_AGENT_VERSION ?? "agent-runtime/unknown",
  });
});

function readCgroupBytes(v2: string, v1: string): number | null {
  for (const p of [v2, v1]) {
    try {
      const raw = readFileSync(p, "utf8").trim();
      if (raw === "max") return Infinity;
      const n = Number.parseInt(raw, 10);
      if (Number.isFinite(n)) return n;
    } catch {}
  }
  return null;
}

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
  } catch {}
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
