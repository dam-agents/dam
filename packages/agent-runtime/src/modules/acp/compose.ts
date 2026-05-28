import { createChildAgentProcess } from "./infrastructure/create-child-agent-process.js";
import { createAcpRuntime, type AcpRuntime } from "./services/acp-runtime.js";
import {
  createTriggerSessionDriver,
  type TriggerSessionDriver,
} from "./services/trigger-session-driver.js";

export interface ComposeAcpOptions {
  command: string[];
  workingDir: string;
  env?: Record<string, string | undefined>;
  log?: (msg: string) => void;
}

export function composeAcp(opts: ComposeAcpOptions): {
  runtime: AcpRuntime;
  triggerDriver: TriggerSessionDriver;
} {
  const runtime = createAcpRuntime({
    spawnAgent: () =>
      createChildAgentProcess({
        command: opts.command,
        workingDir: opts.workingDir,
        env: opts.env,
      }),
    workingDir: opts.workingDir,
    log: opts.log,
  });
  const triggerDriver = createTriggerSessionDriver({ acpRuntime: runtime });
  return { runtime, triggerDriver };
}
