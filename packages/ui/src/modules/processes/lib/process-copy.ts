import type { FinishedRow, ProcessKind, ProcessRow } from "agent-runtime-api";

export const PROCESS_KIND_ORDER: readonly ProcessKind[] = [
  "turn",
  "harness-task",
  "detached",
];

export const PROCESS_KIND_LABEL: Record<ProcessKind, string> = {
  turn: "Foreground",
  "harness-task": "Harness task",
  detached: "Detached",
};

export const ENDED_BY_LABEL: Record<FinishedRow["endedBy"], string> = {
  exit: "Exited",
  stop: "Stopped by you",
  hibernation: "Ended by hibernation",
};

export function keepStatusLabel(
  row: Pick<ProcessRow, "kind" | "keepsAwake">,
  alwaysOn: boolean,
): string {
  if (row.kind === "turn") return "Ends with the turn";
  if (row.keepsAwake) return "Keeps the agent awake";
  return alwaysOn ? "Runs until stopped" : "Stops at hibernation";
}
