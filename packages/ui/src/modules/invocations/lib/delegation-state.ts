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

export function firstLine(prompt: string): string {
  return (
    prompt
      .split("\n")
      .find((line) => line.trim() !== "")
      ?.trim() ?? ""
  );
}

export function flattenIds(nodes: readonly DelegationNode[]): string[] {
  return nodes.flatMap((node) => [node.id, ...flattenIds(node.children)]);
}

export function hasRunning(nodes: readonly DelegationNode[]): boolean {
  return nodes.some(
    (node) => node.status === "running" || hasRunning(node.children),
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
