import { config } from "../config.js";
import type { DocumentStoreBackend } from "../../core/document-store.js";
import type { ArtifactTouch } from "./infrastructure/artifact-touch.js";
import {
  mergedSpawnEnv,
  type RuntimeEnvReader,
} from "../../core/runtime-env.js";
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
  type AcpRuntime,
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

export interface ComposeAcpOptions {
  command: string[];
  workingDir: string;
  stateBackend: DocumentStoreBackend;
  envReader: RuntimeEnvReader;
  sessionHistory?: {
    module?: string;
    exportName?: string;
    command?: string[];
  };
  isTerminalSessionActive?: (sessionId: string) => boolean;
  backgroundWorkHolds?: boolean;
  onArtifactTouch: (touch: ArtifactTouch) => void;
  beforeFirstSpawn?: () => Promise<void>;
  log?: (msg: string) => void;
}

function historyProviderOf(
  opts: ComposeAcpOptions,
): HistoryProvider | undefined {
  const declared = opts.sessionHistory;
  const log = (msg: string): void => opts.log?.(msg);
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
  runtime: AcpRuntime;
  triggerDriver: TriggerSessionDriver;
  sessionMetadata: SessionMetadataStore;
  backgroundWork: BackgroundWorkRegistry;
  sessions: SessionsService;
  sessionChanges: SessionChanges;
  activeTurns: ActiveTurnStore;
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
    log: opts.log,
  });
  const undeliveredPrompts = createUndeliveredPromptStore(
    opts.stateBackend,
    () => new Date().toISOString(),
  );
  const activeTurns = createActiveTurnStore(opts.stateBackend);
  const runtime = createAcpRuntime({
    undeliveredPrompts,
    activeTurns,
    runResults: createRunResultStore(opts.stateBackend),
    sessionMcpServers: (ref) => platformMcpEntry.sessionServers(ref),
    onReportableTurnEnded: (report) => reportTurn(report),
    spawnAgent: () =>
      createChildAgentProcess({
        command: opts.command,
        workingDir: opts.workingDir,
        env: mergedSpawnEnv(opts.envReader),
      }),
    backgroundWork,
    workingDir: opts.workingDir,
    sessionMetadata,
    isTerminalSessionActive: opts.isTerminalSessionActive,
    onArtifactTouch: opts.onArtifactTouch,
    historyProvider: historyProviderOf(opts),
    log: opts.log,
    envReadyAtBoot: opts.envReader.ready(),
    ...(opts.beforeFirstSpawn
      ? { beforeFirstSpawn: opts.beforeFirstSpawn }
      : {}),
    idleReapDelayMs: 3_000,
    ...(config.QUEUE_PARK_MS !== undefined
      ? { queueParkMs: config.QUEUE_PARK_MS }
      : {}),
  });
  const triggerDriver = createTriggerSessionDriver({ acpRuntime: runtime });
  reportTurn = createOnceReporter({
    driver: triggerDriver,
    findSessionByRef: (ref) => sessionMetadata.findByRef(ref),
    log: (msg) => opts.log?.(msg),
  });
  const sessions = createSessionsService({
    openCaller: () =>
      createInProcessCaller((channel) =>
        runtime.attach(channel, { viewer: false }),
      ),
    sessionMetadata,
    isRunning: (sessionId) => runtime.isSessionRunning(sessionId),
    changes: sessionChanges,
  });

  return {
    runtime,
    triggerDriver,
    sessionMetadata,
    backgroundWork,
    sessions,
    sessionChanges,
    activeTurns,
    platformMcpEntry,
  };
}
