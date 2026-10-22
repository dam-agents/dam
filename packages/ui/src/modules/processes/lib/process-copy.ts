import type {
  ContainerEngine,
  FinishedRow,
  PendingRestart,
  ProcessContainer,
  ProcessKind,
  ProcessRow,
  StartupItem,
} from "agent-runtime-api";
import { match } from "ts-pattern";

import type { ProcessGroupId } from "./process-groups.js";

export const BACKGROUND_KIND_LABEL: Record<
  Exclude<ProcessKind, "turn">,
  string
> = {
  "harness-task": "Background task",
  detached: "Detached",
  "startup-item": "Login item",
};

const CONTAINER_ENGINE_LABEL: Record<ContainerEngine, string> = {
  docker: "Docker",
  k3s: "k3s",
  containerd: "containerd",
};

export function containerLabel(container: ProcessContainer): string {
  const engine = CONTAINER_ENGINE_LABEL[container.engine];
  return match(container.role)
    .with("container", () => `${engine} container`)
    .with("runtime", () => `${engine} runtime`)
    .exhaustive();
}

export function processKindLabel(
  row: Pick<ProcessRow, "kind" | "container">,
): string | null {
  if (row.container) return containerLabel(row.container);
  return row.kind === "turn" ? null : BACKGROUND_KIND_LABEL[row.kind];
}

export function processTitle(
  row: Pick<ProcessRow, "command" | "container">,
): string {
  return row.container?.role === "container" ? row.container.id : row.command;
}

export const PROCESS_GROUP_LABEL: Record<ProcessGroupId, string> = {
  turn: "In active turns",
  awake: "Keeping the agent awake",
  hibernates: "Stops when the agent sleeps",
  "always-on": "Running",
};

export const ENDED_BY_LABEL: Record<FinishedRow["endedBy"], string> = {
  exit: "Exited",
  stop: "Stopped by you",
  hibernation: "Ended when the agent slept",
};

export const ALWAYS_ON_KEEP_HINT =
  "This agent is Always on. Nothing here stops for sleep.";

export const NO_PID_STOP_HINT = "Can't find this task's process";

export function loginItemStatus(
  item: Pick<StartupItem, "disabled" | "running" | "listed">,
): string {
  if (!item.listed) return "Running, no longer in the list";
  if (item.disabled)
    return item.running ? "Off from the next wake, still running" : "Off";
  return item.running ? "Running" : "Not running";
}

export function loginItemBootCaption(
  item: Pick<StartupItem, "disabled" | "listed">,
) {
  if (!item.listed) return "Not in the list, so it won't start again";
  return item.disabled ? "Won't start at the next wake" : "Set up by the agent";
}

export function loginItemOutputKey(id: string): string {
  return `startup:${id}`;
}

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
