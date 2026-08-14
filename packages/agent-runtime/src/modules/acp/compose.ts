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
  const backgroundWork = createBackgroundWorkRegistry({
    enabled: opts.backgroundWorkHolds,
    log: opts.log,
  });
  const runtime = createAcpRuntime({
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
    envReadyAtBoot: opts.envReader.ready(),
    idleReapDelayMs: 3_000,
  });
  const triggerDriver = createTriggerSessionDriver({ acpRuntime: runtime });
  return { runtime, triggerDriver, sessionMetadata, backgroundWork };
}
