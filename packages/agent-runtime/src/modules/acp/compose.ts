import type { DocumentStoreBackend } from "../../core/document-store.js";
import {
  mergedSpawnEnv,
  type RuntimeEnvReader,
} from "../../core/runtime-env.js";
import { createChildAgentProcess } from "./infrastructure/create-child-agent-process.js";
import { createProcFsProcessTable } from "./infrastructure/process-table.js";
import {
  createSessionMetadataStore,
  type SessionMetadataStore,
} from "./infrastructure/session-metadata-store.js";
import { createAcpRuntime, type AcpRuntime } from "./services/acp-runtime.js";
import { createBackgroundWorkTracker } from "./services/background-work-tracker.js";
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
  log?: (msg: string) => void;
}

export function composeAcp(opts: ComposeAcpOptions): {
  runtime: AcpRuntime;
  triggerDriver: TriggerSessionDriver;
  sessionMetadata: SessionMetadataStore;
} {
  const sessionMetadata = createSessionMetadataStore(opts.stateBackend);
  // The live harness's pid roots background-work tracking. Held here rather
  // than inside the runtime so the runtime never deals in pids: it asks the
  // tracker about sessions, and the tracker asks the OS about processes.
  let harnessPid: number | undefined;
  const runtime = createAcpRuntime({
    // Env read fresh per spawn; process.env wins (user env > placeholders).
    spawnAgent: () => {
      const agent = createChildAgentProcess({
        command: opts.command,
        workingDir: opts.workingDir,
        env: mergedSpawnEnv(opts.envReader),
      });
      harnessPid = agent.pid;
      return agent;
    },
    backgroundWork: createBackgroundWorkTracker({
      processTable: createProcFsProcessTable(),
      harnessPid: () => harnessPid,
      log: opts.log,
    }),
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
  return { runtime, triggerDriver, sessionMetadata };
}
