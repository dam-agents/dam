import type { DocumentStoreBackend } from "../../core/document-store.js";
import {
  mergedSpawnEnv,
  type RuntimeEnvReader,
} from "../../core/runtime-env.js";
import { createChildAgentProcess } from "./infrastructure/create-child-agent-process.js";
import {
  createSessionMetadataStore,
  type SessionMetadataStore,
} from "./infrastructure/session-metadata-store.js";
import {
  createAcpRuntime,
  type AcpRuntime,
} from "./services/acp-runtime/acp-runtime.js";
import {
  createBackgroundWorkRegistry,
  type BackgroundWorkRegistry,
} from "./services/background-work-registry.js";
import {
  createTriggerSessionDriver,
  type TriggerSessionDriver,
} from "./services/trigger-session-driver.js";

export interface ComposeAcpOptions {
  command: string[];
  workingDir: string;
  stateBackend: DocumentStoreBackend;
  envReader: RuntimeEnvReader;
  isTerminalSessionActive?: (sessionId: string) => boolean;
  /** False refuses every background-work hold (the feature's kill switch). */
  backgroundWorkHolds?: boolean;
  log?: (msg: string) => void;
}

export function composeAcp(opts: ComposeAcpOptions): {
  runtime: AcpRuntime;
  triggerDriver: TriggerSessionDriver;
  sessionMetadata: SessionMetadataStore;
  backgroundWork: BackgroundWorkRegistry;
} {
  const sessionMetadata = createSessionMetadataStore(opts.stateBackend);
  // Sessions report their in-flight background work here (the contract lives in
  // agent-runtime-api). The runtime reads it when deciding whether to close a
  // session or to call itself idle; the server exposes the reporting route.
  const backgroundWork = createBackgroundWorkRegistry({
    enabled: opts.backgroundWorkHolds,
    log: opts.log,
  });
  const runtime = createAcpRuntime({
    // Env read fresh per spawn; process.env wins (user env > placeholders).
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
    log: opts.log,
    // Warm restart (env on the PV) spawns now; cold boot gates until env arrives.
    envReadyAtBoot: opts.envReader.ready(),
    // Let a turn's trailing work settle (and quick re-attaches reconnect)
    // before reaping the harness subprocess.
    idleReapDelayMs: 3_000,
  });
  const triggerDriver = createTriggerSessionDriver({ acpRuntime: runtime });
  return { runtime, triggerDriver, sessionMetadata, backgroundWork };
}
