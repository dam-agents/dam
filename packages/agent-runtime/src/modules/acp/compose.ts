import { config } from "../config.js";
import type { DocumentStoreBackend } from "../../core/document-store.js";
import type { ArtifactTouch } from "./infrastructure/artifact-touch.js";
import { leaseSpawnEnv, type LeaseEnvReader } from "../../core/runtime-env.js";
import { createChildAgentProcess } from "./infrastructure/create-child-agent-process.js";
import {
  createExecHistoryProvider,
  createWorkerHistoryProvider,
  type HistoryProvider,
} from "./infrastructure/history-provider.js";
import { createExecSpendProvider } from "./infrastructure/spend-provider.js";
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
  type ReportableTurn,
} from "./services/acp-runtime/acp-runtime.js";
import { createOnceReporter } from "./services/once-reporter.js";
import {
  createBackgroundWorkRegistry,
  type BackgroundWorkRegistry,
} from "./services/background-work-registry.js";
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
  type KeptProcesses,
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
  isKeptTask: (sessionId: string, taskId: string) => boolean;
  keptProcesses: KeptProcesses;
  onArtifactTouch: (touch: ArtifactTouch) => void;
  beforeSpawn: () => Promise<void>;
  leaseModel: (lease: {
    harness: string;
    provider: string | null;
  }) => Promise<string | null>;
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
  sessionSpend?: { command: string[]; unit: string };
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
  sessions: SessionsService;
  sessionChanges: SessionChanges;
  activeTurns: ActiveTurnStore;
  subAgentSessions: SubAgentSessionStore;
  platformMcpEntry: PlatformMcpEntryStore;
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
    isKept: (sessionId, item) => opts.isKeptTask(sessionId, item.id),
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
    providers: () => opts.envReader.providers(),
    sessionMetadata,
    backgroundWork,
    keptProcesses: opts.keptProcesses,
    log: opts.log,
    createRuntime: (pair, scoped) => {
      const harness = opts.harnesses[pair.harness];
      const ownHistory = historyProviders.get(pair.harness);
      const ownPins = harness?.terminalSessionPins;
      const isDefault =
        pair.harness === opts.defaultHarness &&
        pair.model === null &&
        pair.provider === (opts.envReader.providers()[0] ?? null);
      const seedsLease =
        !isDefault && pair.model === null && harness?.sessionModel !== true;
      let seeded: string | null = null;
      const seedLease = async (): Promise<void> => {
        seeded = await opts.leaseModel(scoped.pair());
        if (seeded) opts.log(`[${pair.harness}] lease runs on ${seeded}`);
      };
      return createAcpRuntime({
        undeliveredPrompts,
        activeTurns,
        runResults,
        sessionMcpServers: (ref) => platformMcpEntry.sessionServers(ref),
        onReportableTurnEnded: (report) => reportTurn(report),
        spawnAgent: () => {
          scoped.harnessSpawned();
          return createChildAgentProcess({
            command: opts.command,
            workingDir: opts.workingDir,
            env: leaseSpawnEnv(opts.envReader, {
              ...scoped.pair(),
              model: scoped.pair().model ?? seeded,
            }),
          });
        },
        backgroundWork: scoped.backgroundWork,
        onHarnessExited: scoped.onHarnessExited,
        workingDir: opts.workingDir,
        sessionMetadata,
        isTerminalSessionActive: opts.isTerminalSessionActive,
        onArtifactTouch: opts.onArtifactTouch,
        onSubAgentSpawn: ({ sessionId, subAgentIds }) =>
          subAgentSessions.record(sessionId, subAgentIds),
        ...(ownHistory ? { historyProvider: ownHistory } : {}),
        ...(ownPins
          ? { terminalSessionPins: terminalSessionPinsOf([ownPins]) }
          : {}),
        log: (msg) => opts.log(`[${pair.harness}] ${msg}`),
        envReadyAtBoot: opts.envReader.ready(),
        ...(isDefault
          ? { beforeSpawn: opts.beforeSpawn }
          : seedsLease
            ? { beforeSpawn: seedLease }
            : {}),
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
  const sessionSpend = Object.values(opts.harnesses).find(
    (h) => h.sessionSpend,
  )?.sessionSpend;
  const sessions = createSessionsService({
    openCaller: () =>
      createInProcessCaller((channel) =>
        runtime.attach(channel, { viewer: false }),
      ),
    sessionMetadata,
    isRunning: (sessionId) => runtime.isSessionRunning(sessionId),
    changes: sessionChanges,
    sessionFrames: (sessionId) => runtime.sessionFrames(sessionId),
    delegations: createDelegationFramesStore(opts.agentHome),
    ...(historyProvider ? { historyProvider } : {}),
    ...(sessionSpend
      ? {
          spendProvider: createExecSpendProvider({
            command: sessionSpend.command,
            unit: sessionSpend.unit,
            cwd: opts.workingDir,
            log: opts.log,
          }),
        }
      : {}),
    ...(terminalSessionPins ? { terminalSessionPins } : {}),
    log: opts.log,
  });

  return {
    runtime,
    triggerDriver,
    sessionMetadata,
    backgroundWork,
    sessions,
    sessionChanges,
    activeTurns,
    subAgentSessions,
    platformMcpEntry,
  };
}
