import type { Toast } from "../../../lib/toast.js";
import type { AgentView } from "../../../types.js";

export interface CrashMark {
  restarts: number;
  announced?: { reason: string; atRestarts: number };
}

type WatchedAgent = Pick<
  AgentView,
  | "id"
  | "name"
  | "state"
  | "podTerminationReason"
  | "podRestarts"
  | "podRestartReason"
>;

const RESTART_CAUSES: Record<string, string> = {
  OutOfMemory:
    "ran out of memory and restarted — give it a larger size in its settings",
  GuestStoppedAnswering: "stopped responding and restarted",
};

export function restartNotice(agent: WatchedAgent): string {
  const cause = agent.podRestartReason
    ? RESTART_CAUSES[agent.podRestartReason]
    : undefined;
  return `${agent.name} ${cause ?? "crashed and restarted"}`;
}

export function nextCrashNotices(
  previous: ReadonlyMap<string, CrashMark>,
  agents: readonly WatchedAgent[],
): { marks: Map<string, CrashMark>; toasts: Toast[] } {
  const marks = new Map<string, CrashMark>();
  const toasts: Toast[] = [];
  for (const agent of agents) {
    const before = previous.get(agent.id);
    const reason = agent.podTerminationReason;
    let announced = before?.announced;
    if (reason && reason !== announced?.reason) {
      toasts.push({
        kind: "error",
        message: `${agent.name} crashed — ${reason}`,
      });
      announced = { reason, atRestarts: agent.podRestarts };
    }
    const restarted =
      before !== undefined && agent.podRestarts > before.restarts;
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
    });
  }
  return { marks, toasts };
}
