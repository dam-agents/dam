import type { DocumentStoreBackend } from "../../core/document-store.js";
import type { RuntimeEnvReader } from "../../core/runtime-env.js";
import { createChildAgentProcess } from "./infrastructure/create-child-agent-process.js";
import { createSessionMetadataStore } from "./infrastructure/session-metadata-store.js";
import { createAcpRuntime, type AcpRuntime } from "./services/acp-runtime.js";
import {
  createTriggerSessionDriver,
  type TriggerSessionDriver,
} from "./services/trigger-session-driver.js";

export interface ComposeAcpOptions {
  command: string[];
  workingDir: string;
  stateBackend: DocumentStoreBackend;
  envReader: RuntimeEnvReader;
  log?: (msg: string) => void;
}

export function composeAcp(opts: ComposeAcpOptions): {
  runtime: AcpRuntime;
  triggerDriver: TriggerSessionDriver;
} {
  const sessionMetadata = createSessionMetadataStore(opts.stateBackend);
  const runtime = createAcpRuntime({
    // Env read fresh per spawn; process.env wins (user env > placeholders).
    spawnAgent: () =>
      createChildAgentProcess({
        command: opts.command,
        workingDir: opts.workingDir,
        env: { ...opts.envReader.current(), ...process.env },
      }),
    workingDir: opts.workingDir,
    sessionMetadata,
    log: opts.log,
    // Warm restart (env on the PV) spawns now; cold boot gates until env arrives.
    envReadyAtBoot: opts.envReader.ready(),
  });
  const triggerDriver = createTriggerSessionDriver({ acpRuntime: runtime });
  return { runtime, triggerDriver };
}
