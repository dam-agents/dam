import { parseQualifiedModel } from "api-server-api";
import { config } from "../config.js";
import type { DocumentStoreBackend } from "../../core/document-store.js";
import type { ArtifactTouch } from "./infrastructure/artifact-touch.js";
import type { ToolActivity } from "../changes/index.js";
import { leaseSpawnEnv, type LeaseEnvReader } from "../../core/runtime-env.js";
import {
  isPlatformSubagentSetting,
  platformSubagentSettingsError,
  sessionSettingsError,
  type HarnessConfigCatalog,
  type SessionRepository,
  type SubAgentHarnessConfig,
} from "agent-runtime-api";
import type { SessionSettingBinding } from "../runtime-channel/manifest.js";
import { createChildAgentProcess } from "./infrastructure/create-child-agent-process.js";
import {
  createExecHistoryProvider,
  createWorkerHistoryProvider,
  type HistoryProvider,
} from "./infrastructure/history-provider.js";
import { createRunResultStore } from "./infrastructure/run-result-store.js";
import {
  createPlatformMcpEntryStore,
  type PlatformMcpEntryStore,
} from "./infrastructure/platform-mcp-entry-store.js";
import { createUndeliveredPromptStore } from "./infrastructure/undelivered-prompt-store.js";
import {
  createActiveTurnStore,
  type ActiveTurnStore,
} from "./infrastructure/active-turn-store.js";
import {
  createSessionMetadataStore,
  type SessionMetadataStore,
} from "./infrastructure/session-metadata-store.js";
import {
  createAcpRuntime,
  sessionListAnswer,
  type ReportableTurn,
  type SessionSettingFrame,
} from "./services/acp-runtime/acp-runtime.js";
import type { AgentRequestObserver } from "./services/acp-runtime/pending-agent-requests.js";
import { createOnceReporter } from "./services/once-reporter.js";
import {
  createBackgroundWorkRegistry,
  type BackgroundWorkRegistry,
} from "./services/background-work-registry.js";
import {
  createHarnessWork,
  type HarnessWork,
} from "./services/harness-work.js";
import type { KeepPolicy } from "../processes/index.js";
import {
  createTriggerSessionDriver,
  type TriggerSessionDriver,
} from "./services/trigger-session-driver.js";
import type { SessionsService } from "agent-runtime-api";
import {
  createSessionChanges,
  notifyingSessionMetadataStore,
  type SessionChanges,
} from "./services/session-changes.js";
import { createInProcessCaller } from "./infrastructure/in-process-request.js";
import { createSessionsService } from "./services/sessions-service.js";
import {
  readTerminalSessionPins,
  type PlatformSessionOf,
} from "./infrastructure/terminal-session-pins.js";
import {
  createLeaseRouter,
  type LeaseRouter,
} from "./services/lease-router.js";
import { createDelegationFramesStore } from "./infrastructure/delegation-frames-store.js";
import {
  createSubAgentSessionStore,
  type SubAgentSessionStore,
} from "./infrastructure/sub-agent-session-store.js";

export interface ComposeAcpOptions {
  command: string[];
  workingDir: string;
  agentHome: string;
  stateBackend: DocumentStoreBackend;
  envReader: LeaseEnvReader;
  defaultHarness: string;
  harnesses: Readonly<Record<string, HarnessRuntime>>;
  isTerminalSessionActive: (sessionId: string) => boolean;
  backgroundWorkHolds: boolean;
  keepPolicy: KeepPolicy;
  onArtifactTouch: (touch: ArtifactTouch) => void;
  onToolActivity?: (activity: ToolActivity) => void;
  agentRequests: AgentRequestObserver;
  sessionRepositories?: (sessionId: string) => SessionRepository[];
  onPrompt: () => void;
  providerAliases: () => string[];
  aliasOfConnection: (connectionId: string) => string | null;
  unroutedProviderEnv?: (harness: string) => Record<string, string>;
  routerEnv?: (harness: string) => Record<string, string>;
  nativeConnectionOf?: (harness: string, model: string | null) => string | null;
  nativeEnv?: (connectionId: string) => Record<string, string>;
  leaseIdleMs?: number;
  beforeSpawn?: () => Promise<void>;
  log: (msg: string) => void;
}

export interface HarnessRuntime {
  sessionHistory?: {
    module?: string;
    exportName?: string;
    command?: string[];
  };
  terminalSessionPins?: string;
  sessionModel: boolean;
  sessionModelFrame?: {
    configOption: string;
    render: (model: string) => string;
  };
  initialize?: Record<string, unknown>;
  sessionSettings?: Record<string, SessionSettingBinding>;
  catalog?: HarnessConfigCatalog;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: the name is rendered the way the harness sees
 * the catalog; a native process gets the harness's own name, the part after
 * the Connection's alias. Critical, so a refusal answers the session's
 * prompts rather than running them on a substitute.
 */
function modelFrames(
  harness: HarnessRuntime | undefined,
  sessionId: string,
  choice: { model: string | null },
  native: boolean,
): SessionSettingFrame[] {
  const binding = harness?.sessionModelFrame;
  if (!binding || choice.model === null) return [];
  const value = native
    ? (parseQualifiedModel(choice.model)?.upstreamId ?? choice.model)
    : binding.render(choice.model);
  return [
    {
      method: "session/set_config_option",
      params: {
        sessionId,
        configId: binding.configOption,
        value,
      },
      critical: true,
    },
  ];
}

const isModelSetting = (
  harness: HarnessRuntime | undefined,
  id: string,
): boolean =>
  harness?.catalog?.options.some(
    (o) => o.id === id && o.category === "model",
  ) === true;

const canonicalSetting = (value: string): string => {
  const parsed = parseQualifiedModel(value, { claudePrefix: true });
  return parsed ? `${parsed.alias}/${parsed.upstreamId}` : value;
};

/**
 * UNIT_BOUNDARY_DESCRIPTION: what a platform sub-agent on the session's own
 * harness takes from the session: its provider-qualified model, and each
 * setting the harness binds, except a model-valued one, one for the
 * harness's own subagents, one the Model Router applies, and a value a person
 * must approve, since nobody is there to approve it in an unattended
 * sub-agent.
 */
function inheritedSubAgentConfig(
  harness: HarnessRuntime | undefined,
  meta: { model?: string; settings?: Record<string, string> },
): SubAgentHarnessConfig {
  const parsed = parseQualifiedModel(meta.model, { claudePrefix: true });
  const kept = Object.entries(meta.settings ?? {}).filter(([id, value]) => {
    const binding = harness?.sessionSettings?.[id];
    const option = harness?.catalog?.options.find((o) => o.id === id);
    return (
      binding !== undefined &&
      !("router" in binding) &&
      option !== undefined &&
      option.category !== "model" &&
      !option.subagents &&
      option.choices.some((c) => c.value === value && !c.needsApproval)
    );
  });
  const mode = kept.find(([id]) => {
    const binding = harness?.sessionSettings?.[id];
    return binding !== undefined && "mode" in binding;
  })?.[1];
  const configOptions = Object.fromEntries(
    kept.filter(([id]) => {
      const binding = harness?.sessionSettings?.[id];
      return binding !== undefined && !("mode" in binding);
    }),
  );
  return {
    ...(parsed && { model: `${parsed.alias}/${parsed.upstreamId}` }),
    ...(mode !== undefined && { mode }),
    ...(Object.keys(configOptions).length > 0 && { configOptions }),
  };
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: a native process names a model the way the
 * harness does, without the Connection's alias, as the model frame does.
 */
function processEnvOf(
  harness: HarnessRuntime | undefined,
  settings: Record<string, string> | undefined,
  native: boolean,
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [id, value] of Object.entries(settings ?? {})) {
    const binding = harness?.sessionSettings?.[id];
    if (!binding || !("env" in binding)) continue;
    const rendered =
      native && isModelSetting(harness, id)
        ? (parseQualifiedModel(value, { claudePrefix: true })?.upstreamId ??
          value)
        : value;
    for (const name of binding.env) env[name] = rendered;
  }
  return env;
}

function historyProviderOf(
  opts: ComposeAcpOptions,
  declared: HarnessRuntime["sessionHistory"],
): HistoryProvider | undefined {
  const { log } = opts;
  if (declared?.module !== undefined) {
    return createWorkerHistoryProvider({
      modulePath: declared.module,
      exportName: declared.exportName,
      log,
    });
  }
  if (declared?.command !== undefined) {
    return createExecHistoryProvider({
      command: declared.command,
      cwd: opts.workingDir,
      log,
    });
  }
  return undefined;
}

export function composeAcp(opts: ComposeAcpOptions): {
  runtime: LeaseRouter;
  triggerDriver: TriggerSessionDriver;
  sessionMetadata: SessionMetadataStore;
  backgroundWork: BackgroundWorkRegistry;
  harnessWork: HarnessWork;
  sessions: SessionsService;
  sessionChanges: SessionChanges;
  activeTurns: ActiveTurnStore;
  subAgentSessions: SubAgentSessionStore;
  platformMcpEntry: PlatformMcpEntryStore;
  warmHistory: () => void;
} {
  const sessionChanges = createSessionChanges();
  const platformMcpEntry = createPlatformMcpEntryStore(opts.stateBackend);
  let reportTurn: (report: ReportableTurn) => void = () => {};
  const sessionMetadata = notifyingSessionMetadataStore(
    createSessionMetadataStore(opts.stateBackend),
    sessionChanges,
  );
  const backgroundWork = createBackgroundWorkRegistry({
    enabled: opts.backgroundWorkHolds,
    keepPolicy: opts.keepPolicy,
    log: opts.log,
  });
  const undeliveredPrompts = createUndeliveredPromptStore(
    opts.stateBackend,
    () => new Date().toISOString(),
  );
  const activeTurns = createActiveTurnStore(opts.stateBackend);
  const subAgentSessions = createSubAgentSessionStore(opts.stateBackend);
  const historyProviders = new Map(
    Object.entries(opts.harnesses).map(([name, h]) => [
      name,
      historyProviderOf(opts, h.sessionHistory),
    ]),
  );
  const pinDirs = Object.values(opts.harnesses).flatMap((h) =>
    h.terminalSessionPins ? [h.terminalSessionPins] : [],
  );
  const terminalSessionPinsOf = (dirs: string[]) => (): PlatformSessionOf => {
    const maps = dirs.map(readTerminalSessionPins);
    return (harnessSessionId) =>
      maps.map((of) => of(harnessSessionId)).find((id) => id !== undefined);
  };
  const terminalSessionPins =
    pinDirs.length > 0 ? terminalSessionPinsOf(pinDirs) : undefined;
  const harnessOfSession = (sessionId: string): string =>
    sessionMetadata.get(sessionId)?.meta.harness ?? opts.defaultHarness;
  const historyProvider: HistoryProvider | undefined = [
    ...historyProviders.values(),
  ].some((p) => p !== undefined)
    ? {
        fetch: (sessionId) =>
          historyProviders.get(harnessOfSession(sessionId))?.fetch(sessionId) ??
          Promise.resolve(null),
      }
    : undefined;
  const runResults = createRunResultStore(opts.stateBackend);
  const runtime = createLeaseRouter({
    defaultHarness: opts.defaultHarness,
    harnessKnown: (harness) => Object.hasOwn(opts.harnesses, harness),
    providerAliases: opts.providerAliases,
    aliasOfConnection: opts.aliasOfConnection,
    ...(opts.nativeConnectionOf && {
      nativeConnectionOf: opts.nativeConnectionOf,
    }),
    initializeFor: (harness) => opts.harnesses[harness]?.initialize ?? null,
    listSessions: (isRunning) =>
      sessionListAnswer(sessionMetadata, isRunning, terminalSessionPins?.()),
    agentRequests: opts.agentRequests,
    ...(opts.leaseIdleMs !== undefined && { leaseIdleMs: opts.leaseIdleMs }),
    settingScope: (harness, id) => {
      const binding = opts.harnesses[harness]?.sessionSettings?.[id];
      return binding === undefined
        ? null
        : "env" in binding
          ? "process"
          : "session";
    },
    settingsError: (harness, settings, model) => {
      const runtime = opts.harnesses[harness];
      const unbound = Object.keys(settings).find(
        (id) =>
          !isPlatformSubagentSetting(id) &&
          runtime?.sessionSettings?.[id] === undefined,
      );
      if (unbound)
        return `The ${harness} harness cannot set ${unbound} for one session`;
      const platform = platformSubagentSettingsError(
        settings,
        (h) => opts.harnesses[h]?.catalog,
      );
      if (platform) return platform;
      const native = (m: string | null) =>
        (opts.nativeConnectionOf?.(harness, m) ?? null) !== null;
      const crossed = Object.entries(settings).find(
        ([id, value]) =>
          isModelSetting(runtime, id) &&
          native(canonicalSetting(value)) !== native(model),
      );
      if (crossed)
        return `The ${crossed[0]} setting ${crossed[1]} cannot run beside this session's model: one harness process reaches either the Model Router or a provider it runs natively, not both`;
      return sessionSettingsError(runtime?.catalog, settings, model);
    },
    sessionMetadata,
    backgroundWork,
    keepPolicy: opts.keepPolicy,
    log: opts.log,
    createRuntime: (pair, scoped) => {
      const harness = opts.harnesses[pair.harness];
      const ownHistory = historyProviders.get(pair.harness);
      const ownPins = harness?.terminalSessionPins;
      return createAcpRuntime({
        undeliveredPrompts,
        activeTurns,
        runResults,
        ...(opts.beforeSpawn && { beforeSpawn: opts.beforeSpawn }),
        sessionMcpServers: (ref) => platformMcpEntry.sessionServers(ref),
        onReportableTurnEnded: (report) => reportTurn(report),
        spawnAgent: () => {
          scoped.harnessSpawned();
          return createChildAgentProcess({
            command: opts.command,
            workingDir: opts.workingDir,
            env: {
              ...leaseSpawnEnv(opts.envReader, {
                harness: pair.harness,
                provider: null,
                model: null,
              }),
              ...(pair.native
                ? opts.nativeEnv?.(pair.native)
                : {
                    ...opts.unroutedProviderEnv?.(pair.harness),
                    ...opts.routerEnv?.(pair.harness),
                  }),
              ...processEnvOf(
                harness,
                scoped.pair().settings,
                scoped.pair().native !== undefined,
              ),
            },
          });
        },
        backgroundWork: scoped.backgroundWork,
        onHarnessExited: scoped.onHarnessExited,
        sessionSettingFrames: (sessionId) => [
          ...modelFrames(
            harness,
            sessionId,
            runtime.sessionChoice(sessionId),
            pair.native !== undefined,
          ),
          ...Object.entries(
            sessionMetadata.get(sessionId)?.meta.settings ?? {},
          ).flatMap(([id, value]): SessionSettingFrame[] => {
            const binding = harness?.sessionSettings?.[id];
            if (binding && "mode" in binding)
              return [
                {
                  method: "session/set_mode",
                  params: { sessionId, modeId: value },
                },
              ];
            if (binding && "configOption" in binding)
              return [
                {
                  method: "session/set_config_option",
                  params: { sessionId, configId: binding.configOption, value },
                },
              ];
            return [];
          }),
        ],
        modeSettingId: Object.entries(harness?.sessionSettings ?? {}).find(
          ([, binding]) => "mode" in binding,
        )?.[0],
        workingDir: opts.workingDir,
        sessionMetadata,
        isTerminalSessionActive: opts.isTerminalSessionActive,
        onArtifactTouch: opts.onArtifactTouch,
        ...(opts.onToolActivity && { onToolActivity: opts.onToolActivity }),
        agentRequests: scoped.agentRequests,
        onPrompt: opts.onPrompt,
        onSubAgentSpawn: ({ sessionId, subAgentIds }) =>
          subAgentSessions.record(sessionId, subAgentIds),
        ...(ownHistory ? { historyProvider: ownHistory } : {}),
        ...(ownPins
          ? { terminalSessionPins: terminalSessionPinsOf([ownPins]) }
          : {}),
        log: (msg) => opts.log(`[${pair.harness}] ${msg}`),
        envReadyAtBoot: opts.envReader.ready(),
        idleReapDelayMs: 3_000,
        ...(config.QUEUE_PARK_MS !== undefined
          ? { queueParkMs: config.QUEUE_PARK_MS }
          : {}),
      });
    },
  });
  const triggerDriver = createTriggerSessionDriver({ acpRuntime: runtime });
  reportTurn = createOnceReporter({
    driver: triggerDriver,
    findSessionByRef: (ref) => sessionMetadata.findByRef(ref),
    log: (msg) => opts.log?.(msg),
  });
  const sessions = createSessionsService({
    subAgentContextOf: (meta) => {
      const harness = meta.harness ?? opts.defaultHarness;
      return {
        harness,
        inherited: inheritedSubAgentConfig(opts.harnesses[harness], meta),
      };
    },
    openCaller: () =>
      createInProcessCaller((channel) =>
        runtime.attach(channel, { viewer: false }),
      ),
    sessionMetadata,
    isRunning: (sessionId) => runtime.isSessionRunning(sessionId),
    changes: sessionChanges,
    sessionFrames: (sessionId) => runtime.sessionFrames(sessionId),
    delegations: createDelegationFramesStore(opts.agentHome),
    ...(opts.sessionRepositories && {
      sessionRepositories: opts.sessionRepositories,
    }),
    ...(historyProvider ? { historyProvider } : {}),
    ...(terminalSessionPins ? { terminalSessionPins } : {}),
    log: opts.log,
  });

  return {
    runtime,
    triggerDriver,
    sessionMetadata,
    backgroundWork,
    harnessWork: createHarnessWork({
      registry: backgroundWork,
      router: runtime,
    }),
    sessions,
    sessionChanges,
    activeTurns,
    subAgentSessions,
    platformMcpEntry,
    warmHistory: () => {
      for (const provider of historyProviders.values()) provider?.warm?.();
    },
  };
}
