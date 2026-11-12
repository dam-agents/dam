import type { DelegationNode } from "api-server-api";

import type { AgentView } from "../../../types.js";
import { VM_MEMORY_FULL } from "../../agents/lib/overlay-copy.js";

export type DelegationDisplayState =
  | "working"
  | "waiting"
  | "waiting-for-owner"
  | "needs-answer"
  | "done"
  | "failed"
  | "stopped";

export type DelegationTarget = Pick<
  AgentView,
  "state" | "overBudgetMessage" | "startWaitMessage"
>;

export function delegationWaitReason(
  node: DelegationNode,
  target: DelegationTarget | undefined,
): string | null {
  if (node.status !== "running" || node.started) return null;
  if (node.waitingForOwner) return WAITS_FOR_OWNER;
  if (!target) return null;
  if (target.state === "over_budget")
    return target.overBudgetMessage ?? VM_MEMORY_FULL;
  return target.startWaitMessage ?? null;
}

export const WAITS_FOR_OWNER =
  "Not started yet: it waits for your answer on its network access. See Approvals on Home.";

const isWorking = (node: DelegationNode): boolean =>
  node.status === "running" && !(node.waitingForOwner && !node.started);

export function delegationState(
  node: DelegationNode,
  target: DelegationTarget | undefined,
): DelegationDisplayState {
  if (node.status === "done") return "done";
  if (node.status === "failed") return node.stopped ? "stopped" : "failed";
  if (node.status === "idle") return "waiting";
  if (node.status === "asking") return "needs-answer";
  if (!isWorking(node)) return "waiting-for-owner";
  return delegationWaitReason(node, target) !== null ? "waiting" : "working";
}

export function flattenIds(nodes: readonly DelegationNode[]): string[] {
  return nodes.flatMap((node) => [node.id, ...flattenIds(node.children)]);
}

export function runningSubAgents(node: DelegationNode): number {
  return node.children.reduce(
    (n, child) => n + (isWorking(child) ? 1 : 0) + runningSubAgents(child),
    0,
  );
}

export function hasRunning(nodes: readonly DelegationNode[]): boolean {
  return nodes.some(
    (node) => node.status === "running" || hasRunning(node.children),
  );
}

export function hasAsking(nodes: readonly DelegationNode[]): boolean {
  return nodes.some(
    (node) => node.status === "asking" || hasAsking(node.children),
  );
}

const deadlineLabel = (at: string): string =>
  new Date(at).toLocaleString(undefined, {
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
  });

export const answerByLine = (answerBy: string): string =>
  `Answer by ${deadlineLabel(answerBy)}`;

// UNIT_BOUNDARY_DESCRIPTION: what a card says of a sub-agent's question in place of its usual subtitle: until when it waits, or, once its work goes on, what it goes on from: the owner's answer, or its own default when nobody answered in time. Null once the work has ended, when the result speaks.
export function questionLine(node: DelegationNode): string | null {
  if (node.question) return answerByLine(node.question.answerBy);
  const { answer } = node;
  if (!answer || node.status !== "running") return null;
  if (answer.by === "default")
    return `No answer by ${deadlineLabel(answer.answerBy)}, so it chose “${answer.text}”`;
  return `You answered: “${answer.text}”`;
}

const JUST_ENDED_MS = 60_000;

function justEnded(node: DelegationNode, now: number): boolean {
  return (
    node.status !== "running" &&
    node.completedAt !== null &&
    now - Date.parse(node.completedAt) < JUST_ENDED_MS
  );
}

export function hasJustEnded(
  nodes: readonly DelegationNode[],
  now: number,
): boolean {
  return nodes.some(
    (node) => justEnded(node, now) || hasJustEnded(node.children, now),
  );
}

export function awaitsCapture(
  nodes: readonly DelegationNode[],
  now: number,
): boolean {
  return nodes.some(
    (node) =>
      (justEnded(node, now) &&
        node.script === null &&
        !node.transcriptAvailable) ||
      awaitsCapture(node.children, now),
  );
}

export type DelegationCounts = Record<
  DelegationNode["status"] | "stopped",
  number
>;

export function countByStatus(
  nodes: readonly DelegationNode[],
): DelegationCounts {
  const counts = {
    idle: 0,
    running: 0,
    done: 0,
    failed: 0,
    stopped: 0,
    asking: 0,
  };
  for (const node of nodes) {
    counts[
      node.stopped
        ? "stopped"
        : node.status === "running" && !isWorking(node)
          ? "idle"
          : node.status
    ] += 1;
    const nested = countByStatus(node.children);
    counts.idle += nested.idle;
    counts.running += nested.running;
    counts.done += nested.done;
    counts.failed += nested.failed;
    counts.stopped += nested.stopped;
    counts.asking += nested.asking;
  }
  return counts;
}

// UNIT_BOUNDARY_DESCRIPTION: what a card says of a stop in place of a failure's reason: who stopped it, and the driver's words when it gave them.
export function stoppedLine(stopped: NonNullable<DelegationNode["stopped"]>) {
  if (stopped.by === "user") return "Stopped by you";
  return stopped.reason
    ? `Stopped by its driver: ${stopped.reason}`
    : "Stopped by its driver";
}

export interface DelegationModel {
  ran: string | null;
  requested: string | null;
  substituted: boolean;
}

function sameModel(a: string, b: string): boolean {
  return a === b || a.endsWith(`/${b}`) || b.endsWith(`/${a}`);
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: the model a sub-agent ran, from its turn's
 * telemetry, against the model its driver asked for. The driver may name a
 * model with a provider prefix that the recorded call omits, or the reverse,
 * so a prefix alone never counts as a substitution.
 */
export function delegationModel(
  requested: string | null,
  ran: readonly string[] | undefined,
): DelegationModel {
  const recorded = ran ?? [];
  return {
    ran: recorded.length > 0 ? recorded.join(", ") : null,
    requested,
    substituted:
      requested !== null &&
      recorded.length > 0 &&
      !recorded.some((model) => sameModel(model, requested)),
  };
}
