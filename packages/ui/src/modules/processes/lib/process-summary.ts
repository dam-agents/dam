import type { ProcessList } from "agent-runtime-api";

export interface ProcessSummary {
  running: number;
  keepingAwake: number;
  restartPending: boolean;
}

export function summarizeProcesses(list: ProcessList): ProcessSummary {
  const background = list.running.filter(
    (row) => row.kind !== "turn" && row.kind !== "startup-item",
  );
  return {
    running: background.length,
    keepingAwake: background.filter((row) => row.keepsAwake).length,
    restartPending: list.pendingRestart !== null,
  };
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: the Processes badge stays neutral grey for a count that keeps nothing awake, and turns to the accent colour only once a counted process holds the Agent awake.
 */
export function processesBadgeTone(
  summary: ProcessSummary,
): "neutral" | undefined {
  return summary.keepingAwake > 0 ? undefined : "neutral";
}
