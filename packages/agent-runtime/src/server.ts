import http from "node:http";
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
import { createFileDocumentStoreBackend } from "./core/document-store.js";
import { expandHome } from "./core/expand-home.js";
import { createFilesService } from "./modules/files.js";
import { createImportHandlers, sweepStaging } from "./modules/import/index.js";
import { composeSkills } from "./modules/skills/index.js";
import { configureGitCredentialHelper } from "./modules/git.js";
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
  type RuntimeManifest,
} from "./modules/runtime-channel/manifest.js";

const __dir = dirname(fileURLToPath(import.meta.url));
const homeDir = config.PLATFORM_DEV
  ? join(__dir, "../working-dir")
  : config.HOME_DIR;
const workDir = config.PLATFORM_DEV
  ? join(__dir, "../working-dir")
  : config.WORK_DIR;

// skill-ref driver paths from the manifest, $HOME expanded against home.
function skillRefPaths(manifest: RuntimeManifest, home: string): string[] {
  const binding = manifest.drivers["skill-ref"] as
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
});
const sshService = createSshService(homeDir);
const importHandlers = createImportHandlers(homeDir, workDir, (msg) =>
  process.stderr.write(`[import] ${msg}\n`),
);

const stateBackend = createFileDocumentStoreBackend(homeDir);

// Single shared env store: the env driver writes it; the spawn paths below
// (harness, terminal, ssh, git) read it through the RuntimeEnvReader port.
const envStore = createEnvStateStore(homeDir);

const { runtime: acpRuntime, triggerDriver } = composeAcp({
  command: config.PLATFORM_DEV
    ? ["npx", "tsx", join(__dir, "agent.ts")]
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
  plugins: [
    createEnvPlugin({
      store: envStore,
      onChange: () => {
        acpRuntime.refreshEnv();
        // Env carrying GH_TOKEN just landed — (re)point git's credential helper
        // at gh. Reads the freshly-written env; no-ops without a token.
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

// 32 MB upload headroom: file-uploads go through files.upload as base64
// (≈1.34× overhead) plus JSON wrapping. The server-side FilesService caps
// decoded payloads at 10 MB, so this is purely a transport-layer guard that
// prevents partial reads before the service-level check kicks in.
const TRPC_MAX_BODY_SIZE = 32 * 1024 * 1024;

// The agent's NetworkPolicy admits ingress on this port only from the
// api-server pod; the api-server has already verified the user JWT and
// agent ownership before forwarding. So tRPC routes need no in-process
// auth check — the kernel-level gate is the auth boundary.
const trpcHandler = createHTTPHandler({
  router: appRouter,
  createContext: (): AgentRuntimeContext => ({
    files: filesService,
    skills: skillsService,
    ssh: sshService,
    runtime: runtimeChannel.service,
  }),
  maxBodySize: TRPC_MAX_BODY_SIZE,
});

interface PtySlot {
  pty: nodePty.IPty | null;
  headless: InstanceType<typeof HeadlessTerminal>;
  serialize: InstanceType<typeof SerializeAddon>;
  client: WsWebSocket | null;
  graceTimer: ReturnType<typeof setTimeout> | null;
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

function attachPty(
  sessionId: string,
  ws: WsWebSocket,
  opts: { reset: boolean },
): void {
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
      };
      ptySlots.set(sessionId, slot);
      ptyLog(sessionId, `spawned PTY (${cols}x${rows})`);

      pty.onData((data) => {
        slot.headless.write(data);
        if (slot.client?.readyState === 1)
          slot.client.send(encodeDataFrame(OP_OUTPUT, data));
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
      terminalActive: ptySlots.size > 0,
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

  void runtimeChannel.helloOnBoot({
    agentRuntimeVersion:
      process.env.PLATFORM_AGENT_VERSION ?? "agent-runtime/unknown",
  });
});
