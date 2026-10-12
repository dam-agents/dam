import type { ProcessList } from "agent-runtime-api";

export interface ProcessSummary {
  running: number;
  keepingAwake: number;
  restartPending: boolean;
}

export function summarizeProcesses(list: ProcessList): ProcessSummary {
  const background = list.running.filter((row) => row.kind !== "turn");
  return {
    running: background.length,
    keepingAwake: background.filter((row) => row.keepsAwake).length,
    restartPending: list.pendingRestart !== null,
  };
}
