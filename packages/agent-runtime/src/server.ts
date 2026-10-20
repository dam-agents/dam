import http from "node:http";
import { randomUUID } from "node:crypto";
import { monitorEventLoopDelay } from "node:perf_hooks";
import { existsSync, mkdirSync } from "node:fs";
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
  keepMarkRequestSchema,
  type AgentRuntimeContext,
  type ApplyStateInput,
} from "agent-runtime-api";
import {
  OP_INPUT,
  OP_OUTPUT,
  OP_RESIZE,
  OP_SESSION,
  decodeFrame,
  encodeDataFrame,
  encodeExit,
} from "api-server-api";
import { z } from "zod";
import { createFileDocumentStoreBackend } from "./core/document-store.js";
import { readCgroupBytes, startMemReaper } from "./core/mem-reaper.js";
import { expandHome } from "./core/expand-home.js";
import { createFilesService } from "./modules/files.js";
import { composeArtifactApi } from "./modules/artifact-api/compose.js";
import { composeKbPublish } from "./modules/kb-publish/compose.js";
import { createImportHandlers, sweepStaging } from "./modules/import/index.js";
import { composeSkills, resolveGitHubToken } from "./modules/skills/index.js";
import { createGitCredentialHelperSetup } from "./modules/git/credential-helper.js";
import { createPodServiceSupervisor } from "./modules/pod-service.js";
import {
  createModelCatalog,
  VENDORED_PRICE_TABLE,
} from "./modules/model-catalog/index.js";
import {
  composeModelRouter,
  routerEnvFor,
  createModelCallExporter,
} from "./modules/model-router/index.js";
import {
  createSshService,
  prepareSshd,
  spawnSshd,
  type PreparedSshd,
} from "./modules/ssh.js";
import { moveTerminalSlot } from "./modules/terminal-slots.js";
import {
  agentBrowserCommand,
  createBrowserPreview,
  DISPLAY_COMMAND,
  displayAvailable,
  fileLog,
  LAUNCH_MODE_FILE,
} from "./modules/browser-preview.js";
import {
  startDisplaySupervisor,
  type DisplaySupervisor,
} from "./modules/browser-display.js";
import { config } from "./modules/config.js";
import { composeAcp } from "./modules/acp/compose.js";
import { prepareProcesses } from "./modules/processes/index.js";
import { composeChanges } from "./modules/changes/index.js";
import { recoverInterruptedTurns } from "./modules/acp/services/interrupted-turn-recovery.js";
import {
  createTerminalSessionLookup,
  sessionDirectoryEntries,
} from "./modules/acp/index.js";
import { createWebSocketChannel } from "./modules/acp/infrastructure/create-websocket-channel.js";
import {
  composeRuntimeChannel,
  createArtifactTouchReporter,
  createEnvPlugin,
  createEnvStateStore,
  staleEnvReason,
  createModelDiscovery,
  createFilePlugin,
  createHarnessClient,
  createMcpEntryPlugin,
  createSkillInstallPlugin,
  loadManifest,
  pluginStateRoot,
  readSkillInstallBootState,
  resolveDrivers,
  harnessConfigBindingOf,
  configuredModeOf,
  sessionModelOf,
  type RuntimeManifest,
} from "./modules/runtime-channel/index.js";
import { harnessManifestPaths } from "./modules/runtime-channel/manifest-paths.js";
import { leaseSpawnEnv } from "./core/runtime-env.js";
import { reportHomeVolumeFullOnCrash } from "./core/home-volume-full.js";
import {
  canonicalModel,
  PROVIDER_REMOVED_REASON,
  type SessionChoice,
} from "./modules/acp/services/lease-router.js";
import {
  aliasForTemplateId,
  HARNESS_HOME_PROVIDERS,
  parseQualifiedModel,
} from "api-server-api";
import {
  PROVIDER_DIALECTS,
  renderName,
} from "./modules/model-catalog/index.js";

const __dir = dirname(fileURLToPath(import.meta.url));
const homeDir = config.PLATFORM_DEV
  ? join(__dir, "../working-dir")
  : AGENT_HOME_DIR;
const workDir = config.PLATFORM_DEV
  ? join(__dir, "../working-dir")
  : AGENT_WORK_DIR;

reportHomeVolumeFullOnCrash(homeDir);

try {
  mkdirSync(workDir, { recursive: true });
} catch (err) {
  process.stderr.write(
    `[server] could not create workDir ${workDir}: ${(err as Error).message}\n`,
  );
}

function skillRefPaths(manifest: RuntimeManifest, home: string): string[] {
  const binding = resolveDrivers(manifest)["skill-ref"] as
    { paths?: unknown } | undefined;
  const raw = Array.isArray(binding?.paths) ? binding.paths : [];
  return raw
    .filter((p): p is string => typeof p === "string")
    .map((p) => expandHome(p, home));
}

const defaultHarness = process.env.PLATFORM_HARNESS ?? "";
const harnessManifests: Record<string, RuntimeManifest> = config.PLATFORM_DEV
  ? {
      [defaultHarness]: loadManifest(
        join(__dir, "../../agents/base/rootfs/app/runtime-manifest.yaml"),
      ),
    }
  : Object.fromEntries(
      Object.entries(
        harnessManifestPaths(join(__dir, ".."), defaultHarness),
      ).map(([harness, path]) => [harness, loadManifest(path)]),
    );
const runtimeManifest = harnessManifests[defaultHarness]!;

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
const artifactApi = composeArtifactApi();
const readSidePaths = skillRefPaths(runtimeManifest, homeDir);
const readSideSet = new Set(readSidePaths);
const seedRoots = skillRefPaths(
  runtimeManifest,
  config.IMAGE_WORKSPACE_DIR,
).filter((p) => !readSideSet.has(p));
const pristineSkillPaths = [...seedRoots, STAGED_SKILLS_DIR];
const stateBackend = createFileDocumentStoreBackend(homeDir);
const envStore = createEnvStateStore(homeDir, defaultHarness);
const setupGitCredentialHelper = createGitCredentialHelperSetup(
  envStore,
  (msg) => process.stderr.write(`[git] ${msg}\n`),
);
const changes = composeChanges({
  roots: [workDir, homeDir],
  stateBackend,
  githubToken: () => resolveGitHubToken(envStore.current(), homeDir),
  log: (msg) => process.stderr.write(`[changes] ${msg}\n`),
});
const skillsLog = (msg: string) => process.stderr.write(`[skills] ${msg}\n`);
const { service: skillsService, reconciler: imageSkillReconciler } =
  composeSkills({
    skillPaths: readSidePaths,
    pristineSkillPaths,
    githubToken: () => resolveGitHubToken(envStore.current(), homeDir),
    ...(config.PLATFORM_IMAGE_SKILL_RECONCILE
      ? {
          reconcile: {
            seedRoots,
            stagedRoots: [STAGED_SKILLS_DIR],
            manifestFile: config.SKILL_MANIFEST_FILE,
            stateDir: join(homeDir, ".platform"),
          },
        }
      : {}),
    log: skillsLog,
  });
const sshService = createSshService(homeDir);
const importHandlers = createImportHandlers(homeDir, workDir, (msg) =>
  process.stderr.write(`[import] ${msg}\n`),
);

const artifactTouchReporter = createArtifactTouchReporter({
  client: harnessClient,
  log: (msg) => process.stderr.write(`[artifact-touch] ${msg}\n`),
});

const podServicePath = "/usr/local/bin/pod-service";
const podLog = (msg: string) => process.stderr.write(`[pod-service] ${msg}\n`);
const podService = existsSync(podServicePath)
  ? createPodServiceSupervisor({
      command: podServicePath,
      envReader: envStore,
      log: podLog,
    })
  : null;

const modelCatalog = createModelCatalog({
  envState: () => envStore.state(),
  envReady: envStore.ready,
  discover: createModelDiscovery({
    log: (msg) => process.stderr.write(`[model-catalog] ${msg}\n`),
  }),
  harnesses: Object.fromEntries(
    Object.entries(harnessManifests).map(([name, m]) => [name, m.modelRouter]),
  ),
  table: VENDORED_PRICE_TABLE,
  log: (msg) => process.stderr.write(`${msg}\n`),
});

if (envStore.ready()) void modelCatalog.refresh();
modelCatalog.start();

const modelRouterLog = (msg: string) => process.stderr.write(`${msg}\n`);
const modelCallExporter = createModelCallExporter({
  envState: () => envStore.state(),
  log: modelRouterLog,
});
/**
 * UNIT_BOUNDARY_DESCRIPTION: the lease router and the Session metadata are
 * composed after the Model Router, so their lookups are bound once they exist.
 */
let sessionChoiceOf: ((sessionId: string) => SessionChoice) | null = null;
let isRuntimeSession: ((sessionId: string) => boolean) | null = null;
const TERMINAL_PIN_REFRESH_MS = 2_000;
const terminalSessionOf = createTerminalSessionLookup(
  Object.values(harnessManifests).flatMap((m) =>
    m.terminalSessionPins ? [expandHome(m.terminalSessionPins, homeDir)] : [],
  ),
  TERMINAL_PIN_REFRESH_MS,
);
const modelRouter = composeModelRouter({
  sessionModelOf: (sessionId) => {
    const choice = sessionChoiceOf?.(sessionId);
    const subagentModel = choice?.settings?.subagentModel ?? null;
    const subagentEffort = choice?.settings?.subagentEffort ?? null;
    if (!choice?.model && !subagentModel && !subagentEffort) return null;
    return { model: choice?.model ?? null, subagentModel, subagentEffort };
  },
  isSession: (sessionId) => isRuntimeSession?.(sessionId) ?? true,
  terminalSessionOf,
  catalog: modelCatalog,
  envState: () => envStore.state(),
  harnesses: Object.fromEntries(
    Object.entries(harnessManifests).map(([name, m]) => [name, m.modelRouter]),
  ),
  defaultHarness,
  port: config.PLATFORM_MODEL_ROUTER_PORT,
  onCall: (record) => modelCallExporter.record(record),
  log: modelRouterLog,
});
await modelRouter.listen();
const grantedAliases = (): string[] => [
  ...new Set(
    envStore.state().providers.flatMap((l) => {
      const alias = l.template ? aliasForTemplateId(l.template) : null;
      return alias ? [alias] : [];
    }),
  ),
];
const aliasOfConnection = (connectionId: string): string | null => {
  const layer = envStore.state().providers.find((l) => l.id === connectionId);
  return layer?.template ? aliasForTemplateId(layer.template) : null;
};
/**
 * UNIT_BOUNDARY_DESCRIPTION: the env of a provider Connection the router does
 * not serve (Bedrock) reaches a harness process only when no granted provider
 * serves that harness through the router, since the harness's shim picks
 * Bedrock whenever it is set; beside a routed provider, a session names
 * Bedrock by its model and runs in a native process of its own.
 */
const FIRST_LISTING_WAIT_MS = 10_000;
const unroutedProviderEnv = (harness: string): Record<string, string> => {
  if (routerEnvOf(harness).PLATFORM_MODEL_ROUTER_SERVES) return {};
  return Object.assign(
    {},
    ...envStore.state().providers.flatMap((l) => {
      const alias = l.template ? aliasForTemplateId(l.template) : null;
      const routed = alias !== null && PROVIDER_DIALECTS[alias].length > 0;
      return routed ? [] : [l.env];
    }),
  ) as Record<string, string>;
};
/**
 * UNIT_BOUNDARY_DESCRIPTION: the Connection a session runs on outside the
 * router, when its model's alias names one the harness's manifest runs
 * natively; a session with no model runs natively when the harness's home
 * provider is such a Connection.
 */
const nativeConnectionOf = (
  harness: string,
  model: string | null,
): string | null => {
  const templates = harnessManifests[harness]?.modelRouter?.native?.templates;
  if (!templates) return null;
  const native = (alias: string) =>
    envStore
      .state()
      .providers.find(
        (l) =>
          l.template !== undefined &&
          templates.includes(l.template) &&
          aliasForTemplateId(l.template) === alias,
      )?.id ?? null;
  if (model) {
    const alias = parseQualifiedModel(model)?.alias;
    return alias ? native(alias) : null;
  }
  const home = HARNESS_HOME_PROVIDERS[harness]?.[0];
  return home ? native(home) : null;
};
const nativeEnv = (connectionId: string): Record<string, string> =>
  envStore.state().providers.find((l) => l.id === connectionId)?.env ?? {};
/**
 * UNIT_BOUNDARY_DESCRIPTION: a terminal's harness starts with the same model
 * env as its chat process: a native Connection's env and the harness's own
 * model name, else the router's env and catalog name.
 */
const terminalModelEnv = (lease: {
  harness: string;
  model: string | null;
}): Record<string, string> => {
  const native = nativeConnectionOf(lease.harness, lease.model);
  if (native)
    return {
      ...nativeEnv(native),
      ...(lease.model !== null && {
        PLATFORM_MODEL:
          parseQualifiedModel(lease.model)?.upstreamId ?? lease.model,
      }),
    };
  return {
    ...unroutedProviderEnv(lease.harness),
    ...routerEnvOf(lease.harness),
    ...(lease.model !== null && {
      PLATFORM_MODEL: renderSessionModel(
        lease.model,
        harnessManifests[lease.harness]?.modelRouter,
      ),
    }),
  };
};
const renderSessionModel = (
  model: string,
  binding: RuntimeManifest["modelRouter"],
): string => {
  const parsed = parseQualifiedModel(model);
  return parsed ? renderName(parsed, binding) : model;
};
const routerEnvOf = (harness: string): Record<string, string> =>
  routerEnvFor({
    harness,
    binding: harnessManifests[harness]?.modelRouter,
    providers: modelCatalog.providers(),
    port: modelRouter.port,
  });

process.env.PLATFORM_RUNTIME_URL = `http://127.0.0.1:${config.PORT}`;

const processes = prepareProcesses(stateBackend);

const {
  runtime: acpRuntime,
  triggerDriver,
  sessionMetadata,
  backgroundWork,
  harnessWork,
  sessions: sessionsService,
  sessionChanges,
  activeTurns,
  subAgentSessions,
  platformMcpEntry,
  warmHistory,
} = composeAcp({
  command: config.PLATFORM_DEV
    ? ["npx", "-y", "@agentclientprotocol/claude-agent-acp"]
    : ["/usr/local/bin/harness-chat"],
  workingDir: workDir,
  agentHome: homeDir,
  stateBackend,
  envReader: envStore,
  defaultHarness,
  harnesses: Object.fromEntries(
    Object.entries(harnessManifests).map(([name, manifest]) => {
      const harnessConfig = harnessConfigBindingOf(manifest);
      return [
        name,
        {
          sessionHistory: manifest.sessionHistory,
          ...(manifest.terminalSessionPins && {
            terminalSessionPins: expandHome(
              manifest.terminalSessionPins,
              homeDir,
            ),
          }),
          sessionModel: sessionModelOf(manifest),
          ...(manifest.modelRouter?.sessionModel && {
            sessionModelFrame: {
              configOption: manifest.modelRouter.sessionModel.configOption,
              render: (model: string) =>
                (manifest.modelRouter?.sessionModel?.valuePrefix ?? "") +
                renderSessionModel(model, manifest.modelRouter),
            },
          }),
          ...(manifest.initializeCapabilities && {
            initialize: manifest.initializeCapabilities as Record<
              string,
              unknown
            >,
          }),
          sessionSettings: harnessConfig?.sessionSettings,
          catalog: harnessConfig?.catalog,
          ...(harnessConfig?.sessionSettings?.mode !== undefined && {
            configuredMode: () =>
              configuredModeOf(harnessConfig, homeDir, (msg) =>
                process.stderr.write(`[harness-config] ${msg}\n`),
              ),
          }),
        },
      ];
    }),
  ),
  isTerminalSessionActive: isPtySessionActive,
  backgroundWorkHolds: config.BACKGROUND_WORK_HOLDS,
  keepPolicy: processes.keepPolicy,
  onArtifactTouch: artifactTouchReporter.report,
  onToolActivity: changes.onToolActivity,
  sessionRepositories: changes.repositoriesOf,
  onPrompt: startDisplay,
  beforeSpawn: () =>
    Promise.race([
      modelCatalog.listed(),
      new Promise<void>((resolve) => {
        setTimeout(resolve, FIRST_LISTING_WAIT_MS).unref();
      }),
    ]),
  providerAliases: grantedAliases,
  aliasOfConnection,
  unroutedProviderEnv,
  routerEnv: routerEnvOf,
  nativeConnectionOf,
  nativeEnv,
  leaseIdleMs: config.LEASE_IDLE_MS,
  log: (msg) => process.stderr.write(`[acp] ${msg}\n`),
});

sessionChoiceOf = (sessionId) => acpRuntime.sessionChoice(sessionId);
isRuntimeSession = (sessionId) => sessionMetadata.get(sessionId) !== undefined;

const { service: processesService, keepMarks } = processes.start({
  backgroundWorkHolds: config.BACKGROUND_WORK_HOLDS,
  runtimePid: process.pid,
  harnessWork,
  log: (msg) => process.stderr.write(`[processes] ${msg}\n`),
});

let recoveryScheduled = false;
function scheduleRecovery(): void {
  if (recoveryScheduled) return;
  recoveryScheduled = true;
  setTimeout(() => {
    void recoverInterruptedTurns({
      store: activeTurns,
      sessionMetadata,
      triggerDriver,
      log: (msg) => process.stderr.write(`[recovery] ${msg}\n`),
    });
  }, 5_000).unref();
}

const reconcileOnState = imageSkillReconciler
  ? (contributions: ApplyStateInput["state"]["contributions"]) => {
      const names = new Set<string>();
      for (const c of contributions) {
        if (c.kind === "skill-ref") names.add(c.name);
      }
      void imageSkillReconciler.run(names);
    }
  : undefined;

const runtimeChannel = await composeRuntimeChannel({
  subAgentSessions,
  onHarnessConfigApplied: (harness) => acpRuntime.recycleHarness(harness),
  manifests: harnessManifests,
  defaultHarness,
  agentHome: homeDir,
  workDir,
  stateBackend,
  harnessClient,
  triggerDriver,
  findSessionByRef: (ref) => sessionMetadata.findByRef(ref),
  readSessions: () =>
    sessionDirectoryEntries(sessionMetadata.all(), (sessionId) =>
      sessionMetadata.isTombstoned(sessionId),
    ),
  envReader: envStore,
  envStale: () => staleEnvReason(envStore.state()),
  catalog: modelCatalog,
  modelRouter: true,
  plugins: [
    createEnvPlugin({
      store: envStore,
      onChange: (change) => {
        acpRuntime.applyEnvChange(change);
        podService?.refreshEnv();
        void modelCatalog.refresh();
        scheduleRecovery();
      },
    }),
    createFilePlugin(),
    createMcpEntryPlugin({
      onPlatformEntry: (entry) => platformMcpEntry.set(entry),
    }),
    createSkillInstallPlugin({ install: skillsService.install }),
  ],
  onContributionsApplied: setupGitCredentialHelper,
  ...(reconcileOnState && { onSnapshotProcessed: reconcileOnState }),
});

const sshLog = (msg: string) => process.stderr.write(`[ssh] ${msg}\n`);
let preparedSshd: Promise<PreparedSshd | null> | undefined;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

const TRPC_MAX_BODY_SIZE = 70 * 1024 * 1024;

const createTrpcContext = (): AgentRuntimeContext => ({
  artifactApi,
  browser: browserPreview,
  changes,
  files: filesService,
  kbPublish: kbPublish.service,
  sessions: sessionsService,
  skills: skillsService,
  ssh: sshService,
  runtime: runtimeChannel.service,
  harnessConfig: runtimeChannel.harnessConfig,
  processes: processesService,
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
  sessionId: string;
  terminalId: string;
  pty: nodePty.IPty | null;
  headless: InstanceType<typeof HeadlessTerminal>;
  serialize: InstanceType<typeof SerializeAddon>;
  client: WsWebSocket | null;
  graceTimer: ReturnType<typeof setTimeout> | null;
  lastOutputAt: number;
  lastSeenStampAt: number;
  lastActivityStampAt: number;
  lastBusyAt: number;
  lastInputAt: number;
  sawInput: boolean;
  detachedAt: number;
  dying: boolean;
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

sessionChanges.watch(() => runtimeChannel.sessionDirectory.report());

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
const PTY_ACTIVITY_STAMP_DEBOUNCE_MS = 10_000;
const PTY_DETACH_SETTLE_MS = 2_000;

function markTerminalSeen(sessionId: string): void {
  if (sessionMetadata.get(sessionId)) sessionMetadata.recordSeen(sessionId);
  else sessionMetadata.set(sessionId, { mode: "terminal" });
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: a model whose provider the agent no longer holds
 * refuses the terminal with the provider-removed reason, as a chat prompt
 * would be refused.
 */
function terminalLease(
  sessionId: string,
  requested: { harness?: string; model?: string },
): { harness: string; model: string | null } | string {
  const meta = sessionMetadata.get(sessionId)?.meta;
  const harness = meta?.harness ?? requested.harness ?? defaultHarness;
  if (!Object.hasOwn(harnessManifests, harness))
    return `this agent does not carry the ${harness} harness`;
  const chosen =
    meta?.harness !== undefined
      ? acpRuntime.sessionChoice(sessionId).model
      : requested.model !== undefined
        ? canonicalModel(requested.model)
        : null;
  const alias = chosen ? parseQualifiedModel(chosen)?.alias : undefined;
  if (alias && !grantedAliases().includes(alias))
    return PROVIDER_REMOVED_REASON;
  sessionMetadata.set(sessionId, {
    ...meta,
    mode: "terminal",
    harness,
    ...(chosen !== null && { model: chosen }),
  });
  return { harness, model: chosen };
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: Stamps activity for output produced while nobody is
 * attached, which is what makes a terminal session unread. A terminal admits one
 * viewer at a time, so an absent client is an unambiguous "not watching" — while
 * one is attached the seen stamp above covers it, and stamping both would race.
 * Output within PTY_DETACH_SETTLE_MS of a detach is the shell repainting after
 * the viewer's parting resize, and output from a slot being torn down is the
 * harness dying on SIGHUP, which can take seconds. Neither is activity or busy.
 */
function markTerminalActivity(sessionId: string): void {
  if (!sessionMetadata.get(sessionId))
    sessionMetadata.set(sessionId, { mode: "terminal" });
  sessionMetadata.recordActivity(sessionId);
}

function killPtySlot(sessionId: string): void {
  const slot = ptySlots.get(sessionId);
  if (!slot) return;
  if (slot.graceTimer) clearTimeout(slot.graceTimer);
  slot.dying = true;
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
    () => reapPtySlotIfIdle(slot.sessionId),
    PTY_IDLE_REAP_MS - quietMs,
  );
}

function attachPty(
  sessionId: string,
  ws: WsWebSocket,
  opts: { reset: boolean; lease: { harness?: string; model?: string } },
): void {
  if (opts.reset) killPtySlot(sessionId);
  let initialized = false;
  ws.binaryType = "nodebuffer";
  const attached = () =>
    [...ptySlots.values()].find((slot) => slot.client === ws);

  const detach = () => {
    const slot = attached();
    if (!slot) return;
    slot.client = null;
    slot.detachedAt = Date.now();
    markTerminalSeen(slot.sessionId);
    if (!slot.pty) return;
    if (slot.graceTimer) clearTimeout(slot.graceTimer);
    slot.graceTimer = setTimeout(
      () => reapPtySlotIfIdle(slot.sessionId),
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
        existing.detachedAt = 0;
        markTerminalSeen(sessionId);
        existing.lastInputAt = Date.now();
        existing.headless.resize(cols, rows);
        existing.pty?.resize(cols, rows);
        const serialized = existing.serialize.serialize();
        if (serialized.length > 0)
          ws.send(encodeDataFrame(OP_OUTPUT, serialized));
        return;
      }

      const lease = terminalLease(sessionId, opts.lease);
      if (typeof lease === "string") {
        ws.close(1008, lease);
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
      const terminalId = randomUUID();
      startDisplay();
      const pty = nodePty.spawn("/usr/local/bin/harness-terminal", [], {
        name: "xterm-256color",
        cols,
        rows,
        cwd: workDir,
        env: {
          ...(Object.fromEntries(
            Object.entries(
              leaseSpawnEnv(envStore, {
                harness: lease.harness,
                provider: null,
                model: null,
              }),
            ).filter(
              ([k, v]) =>
                v !== undefined &&
                !k.startsWith("npm_config_") &&
                !k.startsWith("npm_lifecycle_"),
            ),
          ) as Record<string, string>),
          ...terminalModelEnv(lease),
          TERM: "xterm-256color",
          COLORTERM: "truecolor",
          HARNESS_SESSION_ID: sessionId,
          PLATFORM_TERMINAL_ID: terminalId,
        },
      });
      const slot: PtySlot = {
        sessionId,
        terminalId,
        pty,
        headless,
        serialize,
        client: ws,
        graceTimer: null,
        lastOutputAt: Date.now(),
        lastActivityStampAt: 0,
        lastSeenStampAt: Date.now(),
        lastBusyAt: 0,
        lastInputAt: 0,
        sawInput: false,
        detachedAt: 0,
        dying: false,
      };
      ptySlots.set(sessionId, slot);
      ptyLog(sessionId, `spawned PTY (${cols}x${rows})`);
      markTerminalSeen(sessionId);

      pty.onData((data) => {
        const now = Date.now();
        slot.lastOutputAt = now;
        const settling =
          slot.dying ||
          (slot.detachedAt > 0 && now - slot.detachedAt < PTY_DETACH_SETTLE_MS);
        if (
          !settling &&
          slot.sawInput &&
          now - slot.lastInputAt > PTY_INPUT_ECHO_MS
        )
          slot.lastBusyAt = now;
        if (
          slot.client &&
          now - slot.lastSeenStampAt > PTY_SEEN_STAMP_DEBOUNCE_MS
        ) {
          slot.lastSeenStampAt = now;
          markTerminalSeen(slot.sessionId);
        }
        if (
          !slot.client &&
          !settling &&
          now - slot.lastActivityStampAt > PTY_ACTIVITY_STAMP_DEBOUNCE_MS
        ) {
          slot.lastActivityStampAt = now;
          markTerminalActivity(slot.sessionId);
        }
        slot.headless.write(data);
        if (slot.client?.readyState === 1)
          slot.client.send(encodeDataFrame(OP_OUTPUT, data));
      });
      pty.onExit(({ exitCode }) => {
        ptyLog(slot.sessionId, `exited ${exitCode}`);
        if (slot.graceTimer) clearTimeout(slot.graceTimer);
        if (slot.client?.readyState === 1) {
          slot.client.send(encodeExit(exitCode));
          slot.client.close(1000, "pty exited");
        }
        slot.pty = null;
        slot.headless.dispose();
        ptySlots.delete(slot.sessionId);
      });
      return;
    }

    const slot = attached();
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

function isLoopback(address: string | undefined): boolean {
  return (
    address === "::1" ||
    address?.startsWith("127.") === true ||
    address?.startsWith("::ffff:127.") === true
  );
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
      keptProcesses: acp.keptProcesses,
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

  const terminalSessionMatch =
    req.method === "POST" &&
    req.url?.match(/^\/api\/terminals\/([^/]+)\/session$/);
  if (terminalSessionMatch) {
    void readJsonBody(req)
      .then((body) => {
        const { sessionId } = z.object({ sessionId: z.uuid() }).parse(body);
        const slot = moveTerminalSlot(
          ptySlots,
          decodeURIComponent(terminalSessionMatch[1]!),
          sessionId,
        );
        if (slot) {
          ptyLog(sessionId, "harness moved its PTY here");
          markTerminalSeen(sessionId);
          if (slot.client?.readyState === 1)
            slot.client.send(encodeDataFrame(OP_SESSION, sessionId));
        }
        res.writeHead(204, CORS).end();
      })
      .catch((err: unknown) => {
        res
          .writeHead(400, { "Content-Type": "application/json", ...CORS })
          .end(JSON.stringify({ error: String(err) }));
      });
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

  if (req.method === "POST" && req.url === "/api/keep-marks") {
    const reply = (status: number, body: unknown) =>
      res
        .writeHead(status, { "Content-Type": "application/json", ...CORS })
        .end(JSON.stringify(body));
    if (!isLoopback(req.socket.remoteAddress)) {
      reply(403, { error: "keep marks are taken from inside the agent only" });
      return;
    }
    void readJsonBody(req)
      .then(async (body) => {
        const parsed = keepMarkRequestSchema.safeParse(body);
        if (!parsed.success) {
          reply(400, { error: parsed.error.message });
          return;
        }
        const result = await keepMarks.mark(parsed.data);
        if (result.ok) reply(200, result.value);
        else
          reply(result.error.kind === "NotFound" ? 404 : 409, {
            error: result.error.message,
          });
      })
      .catch((err: unknown) => {
        reply(400, { error: String(err) });
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
const browserWss = new WebSocketServer({ noServer: true });
const browserLogFile = fileLog(
  join(homeDir, ".local/share/platform/browser.log"),
);
const browserLog = (source: string) => (msg: string) => {
  process.stderr.write(`[${source}] ${msg}\n`);
  browserLogFile(`${source}: ${msg}`);
};
const DISPLAY_IDLE_START_MS = 10_000;
const hasDisplayStack = displayAvailable();
let browserDisplay: DisplaySupervisor | null = null;
function startDisplay(): void {
  if (browserDisplay || !hasDisplayStack) return;
  browserDisplay = startDisplaySupervisor({
    command: DISPLAY_COMMAND,
    envReader: envStore,
    log: browserLog("browser-display"),
  });
}
const runAgentBrowser = agentBrowserCommand(envStore);
const browserPreview = createBrowserPreview({
  run: (args) => {
    startDisplay();
    return runAgentBrowser(args);
  },
  profileDir:
    process.env.AGENT_BROWSER_PROFILE ??
    join(homeDir, ".local/share/platform/browser"),
  socketDir:
    process.env.AGENT_BROWSER_SOCKET_DIR ?? join(homeDir, ".agent-browser"),
  launchModeFile: join(homeDir, LAUNCH_MODE_FILE),
  log: browserLog("browser-preview"),
});

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
    const leaseParam = (name: string): string | undefined =>
      url.searchParams.get(name) || undefined;
    const lease = {
      ...(leaseParam("harness") !== undefined && {
        harness: leaseParam("harness"),
      }),
      ...(leaseParam("provider") !== undefined && {
        provider: leaseParam("provider"),
      }),
      ...(leaseParam("model") !== undefined && { model: leaseParam("model") }),
    };
    termWss.handleUpgrade(req, socket, head, (ws) =>
      attachPty(sessionId, ws, { reset, lease }),
    );
  } else if (url.pathname === "/api/browser/display") {
    startDisplay();
    browserWss.handleUpgrade(req, socket, head, (ws) =>
      browserPreview.attachDisplay(ws),
    );
  } else if (url.pathname === "/api/trpc-ws") {
    trpcWss.handleUpgrade(req, socket, head, (ws) =>
      trpcWss.emit("connection", ws, req),
    );
  } else if (url.pathname === "/api/ssh") {
    startDisplay();
    preparedSshd ??= prepareSshd(homeDir, sshLog).catch((err: Error) => {
      sshLog(`could not prepare sshd: ${err.message}`);
      preparedSshd = undefined;
      return null;
    });
    socket.on("error", () => socket.destroy());
    void preparedSshd.then((prepared) => {
      if (!prepared) {
        socket.destroy();
        return;
      }
      sshWss.handleUpgrade(req, socket, head, (ws) =>
        spawnSshd(ws, prepared, envStore, sshLog),
      );
    });
  } else {
    socket.destroy();
  }
});

server.requestTimeout = 0;
server.headersTimeout = 60_000;

server.listen(config.PORT, () => {
  process.stderr.write(`Platform on http://localhost:${config.PORT}\n`);

  if (envStore.ready()) podService?.refreshEnv();

  modelCatalog.onChange(() =>
    acpRuntime.applyEnvChange({
      namesChanged: false,
      base: null,
      providers: [],
      harnesses: Object.keys(harnessManifests).map((id) => ({
        id,
        namesChanged: false,
      })),
    }),
  );
  acpRuntime.prestart();

  if (imageSkillReconciler) {
    const bootState = readSkillInstallBootState(pluginStateRoot(homeDir));
    if (bootState.kind === "corrupt") {
      skillsLog(
        "skipping boot image-skill reconcile: skill-install state unreadable",
      );
    } else {
      void imageSkillReconciler.run(
        new Set(bootState.kind === "ok" ? bootState.installed : []),
      );
    }
  }

  setTimeout(startDisplay, DISPLAY_IDLE_START_MS).unref();

  warmHistory();

  void sweepStaging(homeDir, (msg) =>
    process.stderr.write(`[import] ${msg}\n`),
  );

  void runtimeChannel.helloOnBoot({
    agentRuntimeVersion:
      process.env.PLATFORM_AGENT_VERSION ?? "agent-runtime/unknown",
  });

  if (envStore.ready()) scheduleRecovery();
});

if (config.MEM_REAPER && !config.PLATFORM_DEV) {
  startMemReaper({
    thresholdFraction: config.MEM_REAPER_THRESHOLD,
    agentProcesses: [
      ...new Set(
        Object.values(harnessManifests).flatMap((m) => m.agentProcesses),
      ),
    ],
    log: (msg) => process.stderr.write(`[mem-reaper] ${msg}\n`),
  });
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
  browserPreview.close();
  browserDisplay?.stop();
  activeTurns.markStopped();
  acpRuntime.shutdown();
  void modelCallExporter.stop();
  setTimeout(() => process.exit(0), 3_000).unref();
}
process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));
