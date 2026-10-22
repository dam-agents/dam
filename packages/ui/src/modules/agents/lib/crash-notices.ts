import { isStartRefusal, TerminationCode } from "api-server-api";

import type { Toast } from "../../../lib/toast.js";
import type { AgentView } from "../../../types.js";

// UNIT_BOUNDARY_DESCRIPTION: a vm agent's restart count is the runner's, which a stop does not reset, while hibernation publishes zero, so the first count a vm agent reports after it slept is a baseline until it is running again, not a crash.
export interface CrashMark {
  restarts: number;
  announced?: { reason: string; atRestarts: number };
  asleep?: true;
}

type WatchedAgent = Pick<
  AgentView,
  | "id"
  | "name"
  | "state"
  | "podTerminationReason"
  | "podTerminationCode"
  | "vm"
  | "podRestarts"
  | "podRestartReason"
>;

const RESTART_CAUSES: Record<string, string> = {
  OutOfMemory:
    "ran out of memory and restarted — give it a larger size in its settings",
  HomeVolumeFull:
    "ran out of storage and restarted — ask it to delete files it no longer needs, or request more storage",
  GuestStoppedAnswering: "stopped responding and restarted",
};

function restartNotice(agent: WatchedAgent): string {
  const cause = agent.podRestartReason
    ? RESTART_CAUSES[agent.podRestartReason]
    : undefined;
  return `${agent.name} ${cause ?? "crashed and restarted"}`;
}

const CONSOLE_ENDS = "\nthe guest console ends:\n";

export function splitConsole(reason: string): {
  text: string;
  consoleTail?: string;
} {
  const cut = reason.indexOf(CONSOLE_ENDS);
  return cut < 0
    ? { text: reason }
    : {
        text: reason.slice(0, cut),
        consoleTail: reason.slice(cut + CONSOLE_ENDS.length),
      };
}

export function terminationNotice(
  subject: string,
  code: string | undefined,
  reason: string,
  vm: boolean,
): string {
  const { text } = splitConsole(reason);
  const sentence = text.charAt(0).toUpperCase() + text.slice(1);
  if (code === TerminationCode.RunnerOutOfMemory)
    return "Your VM agents ran out of memory together, so this agent restarted. Disable agents you aren't using to free memory.";
  if (code === TerminationCode.MachineStorageFull)
    return `${subject} can't start: your VM agents' storage is full. ${sentence}`;
  if (code === TerminationCode.HomeVolumeFull)
    return vm
      ? `${subject} can't start: its storage is full. Free space by deleting files from another running agent or deleting an agent you no longer need, or request more storage.`
      : `${subject} can't start: its storage is full. Request more storage.`;
  if (isStartRefusal(code)) return `${subject} can't start — ${text}`;
  return `${subject} crashed — ${text}`;
}

function joinNames(names: readonly string[]): string {
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

export function nextCrashNotices(
  previous: ReadonlyMap<string, CrashMark>,
  agents: readonly WatchedAgent[],
): { marks: Map<string, CrashMark>; toasts: Toast[] } {
  const marks = new Map<string, CrashMark>();
  const toasts: Toast[] = [];
  const outOfMemory: string[] = [];
  for (const agent of agents) {
    const before = previous.get(agent.id);
    const reason = agent.podTerminationReason;
    let announced = before?.announced;
    if (reason && reason !== announced?.reason) {
      if (agent.podTerminationCode === TerminationCode.RunnerOutOfMemory)
        outOfMemory.push(agent.name);
      else
        toasts.push({
          kind: "error",
          message: terminationNotice(
            agent.name,
            agent.podTerminationCode,
            reason,
            agent.vm,
          ),
        });
      announced = { reason, atRestarts: agent.podRestarts };
    }
    const restarted =
      before !== undefined &&
      !before.asleep &&
      agent.podRestarts > before.restarts;
    const asleep =
      agent.vm &&
      (agent.state === "hibernated" ||
        (before?.asleep === true && agent.state !== "running"));
    const sameCrashRestarting =
      announced !== undefined && agent.podRestarts <= announced.atRestarts + 1;
    if (restarted && !sameCrashRestarting) {
      toasts.push({ kind: "warning", message: restartNotice(agent) });
    }
    if (!reason && (agent.state === "running" || agent.state === "hibernated"))
      announced = undefined;
    marks.set(agent.id, {
      restarts: agent.podRestarts,
      ...(announced ? { announced } : {}),
      ...(asleep ? { asleep } : {}),
    });
  }
  if (outOfMemory.length > 0)
    toasts.push({
      kind: "error",
      message: `Your VM agents ran out of memory together, so ${joinNames(outOfMemory)} restarted. Disable agents you aren't using to free memory.`,
    });
  return { marks, toasts };
}
