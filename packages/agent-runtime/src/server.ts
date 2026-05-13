import http from "node:http";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
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
  OP_INPUT, OP_OUTPUT, OP_RESIZE,
  decodeFrame, encodeDataFrame, encodeExit,
} from "api-server-api";
import { createFilesService } from "./modules/files.js";
import { createImportHandlers, sweepStaging } from "./modules/import/index.js";
import { composeSkills } from "./modules/skills/index.js";
import { config } from "./modules/config.js";
import { composeAcp } from "./modules/acp/compose.js";
import { createWebSocketChannel } from "./modules/acp/infrastructure/create-websocket-channel.js";
import { startTriggerWatcher, type TriggerWatcher } from "./trigger-watcher.js";
import { startPodFilesSync } from "./modules/pod-files/index.js";

let triggerWatcher: TriggerWatcher | undefined;

const __dir = dirname(fileURLToPath(import.meta.url));
const homeDir = config.PLATFORM_DEV
  ? join(__dir, "../working-dir")
  : config.HOME_DIR;
const workDir = config.PLATFORM_DEV
  ? join(__dir, "../working-dir")
  : config.WORK_DIR;

// Boot-time module composition. Skills + Files services are stable across the
// lifetime of the process; createContext just hands them out per-request.
const filesService = createFilesService(homeDir);
const skillsService = composeSkills();
const importHandlers = createImportHandlers(
  homeDir,
  workDir,
  (msg) => process.stderr.write(`[import] ${msg}\n`),
);

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

// 32 MB upload headroom: file-uploads go through files.upload as base64
// (≈1.34× overhead) plus JSON wrapping. The server-side FilesService caps
// decoded payloads at 10 MB, so this is purely a transport-layer guard that
// prevents partial reads before the service-level check kicks in.
const TRPC_MAX_BODY_SIZE = 32 * 1024 * 1024;

// The agent's NetworkPolicy admits ingress on this port only from the
// api-server pod; the api-server has already verified the user JWT and
// instance ownership before forwarding. So tRPC routes need no in-process
// auth check — the kernel-level gate is the auth boundary.
const trpcHandler = createHTTPHandler({
  router: appRouter,
  createContext: (): AgentRuntimeContext => ({
    files: filesService,
    skills: skillsService,
  }),
  maxBodySize: TRPC_MAX_BODY_SIZE,
});

const { runtime: acpRuntime } = composeAcp({
  command: config.PLATFORM_DEV
    ? ["npx", "tsx", join(__dir, "agent.ts")]
    : ["/usr/local/bin/harness-chat"],
  workingDir: workDir,
  log: (msg) => process.stderr.write(`[acp] ${msg}\n`),
});

interface PtySlot {
  pty: nodePty.IPty | null;
  headless: InstanceType<typeof HeadlessTerminal>;
  serialize: InstanceType<typeof SerializeAddon>;
  client: WsWebSocket | null;
  graceTimer: ReturnType<typeof setTimeout> | null;
}

const ptySlots = new Map<string, PtySlot>();
const ptyLog = (sid: string, msg: string) => process.stderr.write(`[pty] [${sid}] ${msg}\n`);

function killPtySlot(sessionId: string): void {
  const slot = ptySlots.get(sessionId);
  if (!slot) return;
  if (slot.graceTimer) clearTimeout(slot.graceTimer);
  try { slot.pty?.kill(); } catch {}
  slot.headless.dispose();
  ptySlots.delete(sessionId);
  ptyLog(sessionId, "killed");
}

function attachPty(sessionId: string, ws: WsWebSocket, opts: { reset: boolean }): void {
  if (opts.reset) killPtySlot(sessionId);
  let initialized = false;
  ws.binaryType = "nodebuffer";

  ws.on("error", () => {
    const slot = ptySlots.get(sessionId);
    if (slot?.client === ws) slot.client = null;
  });
  ws.on("close", () => {
    const slot = ptySlots.get(sessionId);
    if (!slot || slot.client !== ws) return;
    slot.client = null;
    if (!slot.pty) return;
    slot.graceTimer = setTimeout(() => killPtySlot(sessionId), 30_000);
  });

  ws.on("message", (raw: Buffer) => {
    let frame;
    try { frame = decodeFrame(raw); } catch { return; }

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
        if (existing.client && existing.client !== ws && existing.client.readyState === 1) {
          existing.client.close(1000, "replaced by new connection");
        }
        existing.client = ws;
        existing.headless.resize(cols, rows);
        existing.pty?.resize(cols, rows);
        const serialized = existing.serialize.serialize();
        if (serialized.length > 0) ws.send(encodeDataFrame(OP_OUTPUT, serialized));
        return;
      }

      const headless = new HeadlessTerminal({ cols, rows, scrollback: 1000, allowProposedApi: true });
      const serialize = new SerializeAddon();
      headless.loadAddon(serialize);
      const pty = nodePty.spawn("/usr/local/bin/harness-terminal", [], {
        name: "xterm-256color", cols, rows, cwd: workDir,
        env: {
          ...Object.fromEntries(
            Object.entries(process.env).filter(([k, v]) => v !== undefined && !k.startsWith("npm_config_") && !k.startsWith("npm_lifecycle_")),
          ) as Record<string, string>,
          TERM: "xterm-256color", COLORTERM: "truecolor", HARNESS_SESSION_ID: sessionId,
        },
      });
      const slot: PtySlot = { pty, headless, serialize, client: ws, graceTimer: null };
      ptySlots.set(sessionId, slot);
      ptyLog(sessionId, `spawned PTY (${cols}x${rows})`);

      pty.onData((data) => {
        slot.headless.write(data);
        if (slot.client?.readyState === 1) slot.client.send(encodeDataFrame(OP_OUTPUT, data));
      });
      pty.onExit(({ exitCode }) => {
        ptyLog(sessionId, `exited ${exitCode}`);
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
    const s = acpRuntime.status();
    const status = {
      activeClients: s.activeClientCount,
      pendingRequests: s.pendingRequestCount,
      queuedPrompts: s.queuedPromptCount,
      agentAlive: s.agentAlive,
      activeTriggers: triggerWatcher?.activeCount() ?? 0,
      terminalActive: ptySlots.size > 0,
    };
    res.writeHead(200, { "Content-Type": "application/json", ...CORS }).end(JSON.stringify(status));
    return;
  }

  if (req.method === "POST" && req.url === "/api/import") {
    void importHandlers.handleImport(req, res);
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

acpWss.on("connection", (ws) => {
  acpRuntime.attach(createWebSocketChannel(ws));
});

server.on("upgrade", (req, socket, head) => {
  const url = new URL(req.url!, `http://${req.headers.host}`);
  if (url.pathname === "/api/acp") {
    acpWss.handleUpgrade(req, socket, head, (ws) => acpWss.emit("connection", ws, req));
  } else if (url.pathname === "/api/terminal") {
    const sessionId = url.searchParams.get("sessionId") ?? "default";
    const reset = url.searchParams.get("reset") === "1";
    termWss.handleUpgrade(req, socket, head, (ws) => attachPty(sessionId, ws, { reset }));
  } else {
    socket.destroy();
  }
});

if (config.PLATFORM_MCP_URL) {
  const mcpPath = join(workDir, ".mcp.json");
  let mcpConfig: Record<string, unknown> = {};
  if (existsSync(mcpPath)) {
    try { mcpConfig = JSON.parse(readFileSync(mcpPath, "utf8")); } catch {}
  }
  const mcpServers = (mcpConfig.mcpServers ?? {}) as Record<string, unknown>;
  // No Authorization header: the api-server's harness port identifies the
  // caller by source IP (NetworkPolicy admits only agent pods, podIpResolver
  // maps IP → instance label). See ADR-035.
  mcpServers["platform-outbound"] = { type: "http", url: config.PLATFORM_MCP_URL };
  mcpConfig.mcpServers = mcpServers;
  writeFileSync(mcpPath, JSON.stringify(mcpConfig, null, 2));
  process.stderr.write(`[mcp] Wrote platform-outbound to ${mcpPath}\n`);
}

// Configure git to use gh's credential helper. git doesn't know about
// GH_TOKEN directly, so without this it prompts for a username on private
// repos. With this, git asks `gh auth git-credential`, gets the sentinel,
// and the Envoy sidecar swaps it on the wire — same path REST already
// uses. Idempotent; safe to run on every boot.
try {
  const result = spawnSync("gh", ["auth", "setup-git"], { stdio: "pipe" });
  if (result.status !== 0) {
    process.stderr.write(
      `[git] gh auth setup-git exited ${result.status}: ${result.stderr?.toString() ?? ""}\n`,
    );
  }
} catch (e) {
  process.stderr.write(`[git] failed to configure credential helper: ${(e as Error).message}\n`);
}

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

  void sweepStaging(homeDir, (msg) => process.stderr.write(`[import] ${msg}\n`));

  triggerWatcher = startTriggerWatcher({
    triggersDir: config.TRIGGERS_DIR,
    apiServerUrl: config.API_SERVER_URL,
    instanceId: process.env.ADK_INSTANCE_ID ?? process.env.HOSTNAME ?? "unknown",
  });

  // Pod-files sync: opt-in via env. The reconciler sets the URL on instance
  // pods only — forks deliberately don't get it (they're per-turn jobs and
  // don't read pod-files state). See 034-pod-files-push.md.
  if (config.PLATFORM_POD_FILES_EVENTS_URL) {
    startPodFilesSync({
      url: config.PLATFORM_POD_FILES_EVENTS_URL,
      agentHome: homeDir,
    });
  }
});
