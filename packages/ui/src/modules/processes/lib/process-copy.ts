import type {
  FinishedRow,
  PendingRestart,
  ProcessKind,
  ProcessRow,
} from "agent-runtime-api";
import { match } from "ts-pattern";

import type { ProcessGroupId } from "./process-groups.js";

export const BACKGROUND_KIND_LABEL: Record<
  Exclude<ProcessKind, "turn">,
  string
> = {
  "harness-task": "Background task",
  detached: "Detached",
};

export const PROCESS_GROUP_LABEL: Record<ProcessGroupId, string> = {
  turn: "In active turns",
  awake: "Keeping the agent awake",
  hibernates: "Stops at hibernation",
  "always-on": "Running",
};

export const ENDED_BY_LABEL: Record<FinishedRow["endedBy"], string> = {
  exit: "Exited",
  stop: "Stopped by you",
  hibernation: "Ended by hibernation",
};

export function keepSourceCaption(
  row: Pick<ProcessRow, "kind" | "keepSource">,
): string {
  return match(row.keepSource)
    .with("user", () => "Your choice")
    .with("agent", () => "The agent's choice")
    .with("default", () =>
      row.kind === "harness-task"
        ? "On by default for background tasks"
        : "Off by default for detached processes",
    )
    .exhaustive();
}

export const ALWAYS_ON_KEEP_HINT =
  "This agent is Always on. Nothing here stops at hibernation.";

export const NO_PID_STOP_HINT = "Can't find this task's process";

export function countTasks(count: number): string {
  return count === 1 ? "1 task" : `${count} tasks`;
}

function countTurns(count: number): string {
  return count === 1 ? "1 turn" : `${count} turns`;
}

export function countRestartStops(stops: PendingRestart["stops"]): string {
  const tasks = countTasks(stops.tasks);
  return stops.turns === 0 ? tasks : `${tasks}, ${countTurns(stops.turns)}`;
}

export function describeRestartStops({
  tasks,
  turns,
}: PendingRestart["stops"]): string {
  const taskText =
    tasks === 1 ? "1 background task" : `${tasks} background tasks`;
  if (turns === 0) return taskText;
  const turnText = turns === 1 ? "1 running turn" : `${turns} running turns`;
  return `${taskText} and ${turnText}`;
}
