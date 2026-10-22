import type { DelegationNode } from "api-server-api";

import type { AgentState } from "../../../types.js";

export type DelegationDisplayState = "working" | "waiting" | "done" | "failed";

export function delegationState(
  node: DelegationNode,
  agentState: AgentState | undefined,
): DelegationDisplayState {
  if (node.status === "done") return "done";
  if (node.status === "failed") return "failed";
  return agentState === "over_budget" ? "waiting" : "working";
}

export function flattenIds(nodes: readonly DelegationNode[]): string[] {
  return nodes.flatMap((node) => [node.id, ...flattenIds(node.children)]);
}

export function hasRunning(nodes: readonly DelegationNode[]): boolean {
  return nodes.some(
    (node) => node.status === "running" || hasRunning(node.children),
  );
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
      (justEnded(node, now) && !node.transcriptAvailable) ||
      awaitsCapture(node.children, now),
  );
}

export function countByStatus(
  nodes: readonly DelegationNode[],
): Record<DelegationNode["status"], number> {
  const counts = { running: 0, done: 0, failed: 0 };
  for (const node of nodes) {
    counts[node.status] += 1;
    const nested = countByStatus(node.children);
    counts.running += nested.running;
    counts.done += nested.done;
    counts.failed += nested.failed;
  }
  return counts;
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
