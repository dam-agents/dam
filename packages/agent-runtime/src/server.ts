import http from "node:http";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { WebSocketServer } from "ws";
import { createHTTPHandler } from "@trpc/server/adapters/standalone";
import { appRouter } from "agent-runtime-api/router";
import type { AgentRuntimeContext } from "agent-runtime-api";
import { createFilesService } from "./modules/files.js";
import { composeSkills } from "./modules/skills/index.js";
import { config } from "./modules/config.js";
import { composeAcp } from "./modules/acp/compose.js";
import { createWebSocketChannel } from "./modules/acp/infrastructure/create-websocket-channel.js";
import { startTriggerWatcher, type TriggerWatcher } from "./trigger-watcher.js";
import { startPodFilesSync } from "./modules/pod-files/index.js";

let triggerWatcher: TriggerWatcher | undefined;

const __dir = dirname(fileURLToPath(import.meta.url));
const agentCommand = config.AGENT_COMMAND
  ? config.AGENT_COMMAND.split(" ")
  : config.HUMR_DEV
    ? ["npx", "tsx", join(__dir, "agent.ts")]
    : ["node", join(__dir, "agent.js")];
const homeDir = config.HUMR_DEV
  ? join(__dir, "../working-dir")
  : config.HOME_DIR;
const workDir = config.HUMR_DEV
  ? join(__dir, "../working-dir")
  : config.WORK_DIR;

// Boot-time module composition. Skills + Files services are stable across the
// lifetime of the process; createContext just hands them out per-request.
const filesService = createFilesService(homeDir);
const skillsService = composeSkills();

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
  command: agentCommand,
  workingDir: workDir,
  log: (msg) => process.stderr.write(`[acp] ${msg}\n`),
});

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
    };
    res.writeHead(200, { "Content-Type": "application/json", ...CORS }).end(JSON.stringify(status));
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

const wss = new WebSocketServer({ server, path: "/api/acp" });

wss.on("connection", (ws) => {
  acpRuntime.attach(createWebSocketChannel(ws));
});

if (config.HUMR_MCP_URL) {
  const mcpPath = join(workDir, ".mcp.json");
  let mcpConfig: Record<string, unknown> = {};
  if (existsSync(mcpPath)) {
    try { mcpConfig = JSON.parse(readFileSync(mcpPath, "utf8")); } catch {}
  }
  const mcpServers = (mcpConfig.mcpServers ?? {}) as Record<string, unknown>;
  // No Authorization header: the api-server's harness port identifies the
  // caller by source IP (NetworkPolicy admits only agent pods, podIpResolver
  // maps IP → instance label). See ADR-035.
  mcpServers["humr-outbound"] = { type: "http", url: config.HUMR_MCP_URL };
  mcpConfig.mcpServers = mcpServers;
  writeFileSync(mcpPath, JSON.stringify(mcpConfig, null, 2));
  process.stderr.write(`[mcp] Wrote humr-outbound to ${mcpPath}\n`);
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

server.listen(config.PORT, () => {
  process.stderr.write(`Humr on http://localhost:${config.PORT}\n`);

  triggerWatcher = startTriggerWatcher({
    triggersDir: config.TRIGGERS_DIR,
    apiServerUrl: config.API_SERVER_URL,
    instanceId: process.env.ADK_INSTANCE_ID ?? process.env.HOSTNAME ?? "unknown",
  });

  // Pod-files sync: opt-in via env. The reconciler sets the URL on instance
  // pods only — forks deliberately don't get it (they're per-turn jobs and
  // don't read pod-files state). See 034-pod-files-push.md.
  if (config.HUMR_POD_FILES_EVENTS_URL) {
    startPodFilesSync({
      url: config.HUMR_POD_FILES_EVENTS_URL,
      agentHome: homeDir,
    });
  }
});
