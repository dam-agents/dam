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

export function keepSourceCaption(
  row: Pick<ProcessRow, "kind" | "keepSource">,
): string | null {
  switch (row.keepSource) {
    case "agent":
      return "Agent's choice";
    case "user":
      return "Your choice";
    case "default":
      return row.kind === "harness-task" ? "Background task" : null;
  }
}

export const ALWAYS_ON_KEEP_HINT =
  "This agent is Always on. Nothing here stops at hibernation.";

export const NO_PID_STOP_HINT = "Can't find this task's process";

export function countTasks(count: number): string {
  return count === 1 ? "1 task" : `${count} tasks`;
}
