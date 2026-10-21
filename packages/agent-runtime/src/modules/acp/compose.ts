import { parseQualifiedModel } from "api-server-api";
import { config } from "../config.js";
import type { DocumentStoreBackend } from "../../core/document-store.js";
import type { ArtifactTouch } from "./infrastructure/artifact-touch.js";
import type { ToolActivity } from "../changes/index.js";
import { leaseSpawnEnv, type LeaseEnvReader } from "../../core/runtime-env.js";
import {
  isPlatformSubagentSetting,
  modelConstraintsFor,
  platformSubagentSettingsError,
  sessionSettingsError,
  type SessionRepository,
  type SubAgentHarnessConfig,
} from "agent-runtime-api";
import { createChildAgentProcess } from "./infrastructure/create-child-agent-process.js";
import {
  createExecHistoryProvider,
  createWorkerHistoryProvider,
  type HistoryProvider,
} from "./infrastructure/history-provider.js";
import {
  createWorkerSessionCutProvider,
  type SessionCutProvider,
} from "./infrastructure/session-cut-provider.js";
import { createRunResultStore } from "./infrastructure/run-result-store.js";
import {
  createPlatformMcpEntryStore,
  type PlatformMcpEntryStore,
} from "./infrastructure/platform-mcp-entry-store.js";
import { createUndeliveredPromptStore } from "./infrastructure/undelivered-prompt-store.js";
import { createContinuedFromStore } from "./infrastructure/continued-from-store.js";
import {
  createActiveTurnStore,
  type ActiveTurnStore,
} from "./infrastructure/active-turn-store.js";
import { createSessionDefaultsStore } from "./infrastructure/session-defaults-store.js";
import {
  createSessionMetadataStore,
  type SessionMetadataStore,
} from "./infrastructure/session-metadata-store.js";
import {
  createAcpRuntime,
  sessionListAnswer,
  type ReportableTurn,
} from "./services/acp-runtime/acp-runtime.js";
import {
  modeSettingOf,
  sessionSettingFrames,
  type SessionHarness,
} from "./services/session-setting-frames.js";
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
import {
  createSessionsService,
  type RuntimeSessionsService,
} from "./services/sessions-service.js";
import {
  claudeSessionState,
  type HarnessStatePort,
} from "./domain/harness-state.js";
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
  keepPolicy: KeepPolicy;
  onArtifactTouch: (touch: ArtifactTouch) => void;
  onToolActivity?: (activity: ToolActivity) => void;
  onTurnOutcome?: (
    sessionId: string,
    end: { stopReason: string | null; error: string | null },
  ) => void;
  onResultAccepted?: (sessionId: string) => void;
  agentRequests: AgentRequestObserver;
  sessionRepositories?: (sessionId: string) => SessionRepository[];
  onPrompt: () => void;
  providerAliases: () => string[];
  aliasOfConnection: (connectionId: string) => string | null;
  unroutedProviderEnv?: (harness: string) => Record<string, string>;
  routerEnv?: (harness: string) => Record<string, string>;
  nativeConnectionOf?: (harness: string, model: string | null) => string | null;
  modelRequired: (harness: string) => boolean;
  nativeEnv?: (connectionId: string) => Record<string, string>;
  leaseIdleMs?: number;
  beforeSpawn?: () => Promise<void>;
  log: (msg: string) => void;
}

export type HarnessStateDialect = "claude-code";

const HARNESS_STATE_PORTS: Record<HarnessStateDialect, HarnessStatePort> = {
  "claude-code": claudeSessionState,
};

export interface HarnessRuntime extends SessionHarness {
  sessionHistory?: {
    module?: string;
    exportName?: string;
    command?: string[];
  };
  sessionCut?: {
    module: string;
    exportName?: string;
  };
  terminalSessionPins?: string;
  sessionModel: boolean;
  initialize?: Record<string, unknown>;
  harnessState?: HarnessStateDialect;
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
 * UNIT_BOUNDARY_DESCRIPTION: the manifest's own value for each setting a
 * session or process takes from the platform, so a setting nobody chose runs
 * on the harness's documented default and never on whatever its settings
 * file was left with. A setting for the harness's own subagents keeps
 * following the session, and one with no declared default stays the
 * harness's, and so does one the session's model does not take (Haiku takes
 * no effort). So does the permission mode, and any setting whose default a
 * person must approve: such a default asks for approvals, which would stall
 * every unattended turn and undo the mode the agent's image sets for its
 * provider.
 */
function manifestDefaults(
  harness: HarnessRuntime | undefined,
  scope: "session" | "process",
  model?: string | null,
): Record<string, string> {
  const allowed =
    model === undefined
      ? undefined
      : modelConstraintsFor(harness?.catalog, model);
  return Object.fromEntries(
    (harness?.catalog?.options ?? []).flatMap((option) => {
      const binding = harness?.sessionSettings?.[option.id];
      if (
        !binding ||
        option.subagents ||
        option.category === "mode" ||
        option.default === undefined ||
        option.choices.some(
          (c) => c.value === option.default && c.needsApproval,
        ) ||
        allowed?.[option.id]?.includes(option.default) === false
      )
        return [];
      const process = "env" in binding;
      const session = "mode" in binding || "configOption" in binding;
      return (scope === "process" ? process : session)
        ? [[option.id, option.default] as const]
        : [];
    }),
  );
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
  sessions: RuntimeSessionsService;
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
    keepPolicy: opts.keepPolicy,
    log: opts.log,
  });
  const undeliveredPrompts = createUndeliveredPromptStore(
    opts.stateBackend,
    () => new Date().toISOString(),
  );
  const continuedFrom = createContinuedFromStore(opts.stateBackend, () =>
    new Date().toISOString(),
  );
  const activeTurns = createActiveTurnStore(opts.stateBackend);
  const subAgentSessions = createSubAgentSessionStore(opts.stateBackend);
  const historyProviders = new Map(
    Object.entries(opts.harnesses).map(([name, h]) => [
      name,
      historyProviderOf(opts, h.sessionHistory),
    ]),
  );
  const sessionCuts = new Map(
    Object.entries(opts.harnesses).flatMap(
      ([name, h]): [string, SessionCutProvider][] =>
        h.sessionCut
          ? [
              [
                name,
                createWorkerSessionCutProvider({
                  modulePath: h.sessionCut.module,
                  exportName: h.sessionCut.exportName,
                  log: opts.log,
                }),
              ],
            ]
          : [],
    ),
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
    sessionDefaults: createSessionDefaultsStore(opts.stateBackend),
    defaultHarness: opts.defaultHarness,
    harnessKnown: (harness) => Object.hasOwn(opts.harnesses, harness),
    providerAliases: opts.providerAliases,
    aliasOfConnection: opts.aliasOfConnection,
    ...(opts.nativeConnectionOf && {
      nativeConnectionOf: opts.nativeConnectionOf,
    }),
    modelRequired: opts.modelRequired,
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
      const ownCut = sessionCuts.get(pair.harness);
      const ownPins = harness?.terminalSessionPins;
      const settingInput = (sessionId: string) => {
        const model = runtime.sessionChoice(sessionId).model;
        return {
          sessionId,
          harness,
          model,
          native: pair.native !== undefined,
          settings: {
            ...manifestDefaults(harness, "session", model),
            ...sessionMetadata.get(sessionId)?.meta.settings,
          },
        };
      };
      return createAcpRuntime({
        undeliveredPrompts,
        continuedFrom,
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
                {
                  ...manifestDefaults(harness, "process"),
                  ...scoped.pair().settings,
                },
                scoped.pair().native !== undefined,
              ),
            },
          });
        },
        backgroundWork: scoped.backgroundWork,
        onHarnessExited: scoped.onHarnessExited,
        ...(opts.onTurnOutcome && { onTurnOutcome: opts.onTurnOutcome }),
        ...(opts.onResultAccepted && {
          onResultAccepted: opts.onResultAccepted,
        }),
        sessionSettingFrames: (sessionId) =>
          sessionSettingFrames(settingInput(sessionId)),
        modelSettingConfig: harness?.sessionModelFrame?.configOption,
        modeSettingId: modeSettingOf(harness)?.id,
        workingDir: opts.workingDir,
        sessionMetadata,
        ...(harness?.harnessState && {
          harnessState: HARNESS_STATE_PORTS[harness.harnessState],
        }),
        isTerminalSessionActive: opts.isTerminalSessionActive,
        onArtifactTouch: opts.onArtifactTouch,
        ...(opts.onToolActivity && { onToolActivity: opts.onToolActivity }),
        agentRequests: scoped.agentRequests,
        onPrompt: opts.onPrompt,
        onSubAgentSpawn: ({ sessionId, subAgentIds }) =>
          subAgentSessions.record(sessionId, subAgentIds),
        ...(ownHistory ? { historyProvider: ownHistory } : {}),
        ...(ownCut ? { sessionCut: ownCut } : {}),
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
  const triggerDriver = createTriggerSessionDriver({
    acpRuntime: runtime,
    modelRequired: (harness) =>
      opts.modelRequired(harness ?? opts.defaultHarness),
    modelMissing: (sessionId) => runtime.modelMissing(sessionId),
  });
  reportTurn = createOnceReporter({
    driver: triggerDriver,
    findSessionByRef: (ref) => sessionMetadata.findByRef(ref),
    log: (msg) => opts.log?.(msg),
  });
  const sessions = createSessionsService({
    defaultHarness: opts.defaultHarness,
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
