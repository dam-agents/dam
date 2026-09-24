import type { DelegationNode, InvocationStatus } from "api-server-api";

export interface DelegationRecord {
  id: string;
  driverAgentId: string;
  label: string | null;
  prompt: string;
  templateId: string | null;
  image: string | null;
  connections: string[];
  cpu: string | null;
  memory: string | null;
  status: InvocationStatus;
  errorReason: string | null;
  result: unknown;
  createdAt: Date;
  completedAt: Date | null;
}

function toNode(
  row: DelegationRecord,
  children: DelegationNode[],
): DelegationNode {
  return {
    id: row.id,
    label: row.label,
    driverAgentId: row.driverAgentId,
    status: row.status,
    errorReason: row.errorReason,
    result: row.status === "done" ? row.result : null,
    prompt: row.prompt,
    templateId: row.templateId,
    image: row.image,
    connections: row.connections,
    cpu: row.cpu,
    memory: row.memory,
    createdAt: row.createdAt.toISOString(),
    completedAt: row.completedAt?.toISOString() ?? null,
    transcriptAvailable: false,
    children,
  };
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: `rows` is one root driver's whole fan-out history;
 * the result is the subtree under each requested id, in request order, with ids
 * that are not in the set dropped rather than reported.
 */
export function buildDelegationTree(
  rows: readonly DelegationRecord[],
  ids: readonly string[],
): DelegationNode[] {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const childrenOf = new Map<string, DelegationRecord[]>();
  for (const row of rows) {
    const siblings = childrenOf.get(row.driverAgentId) ?? [];
    siblings.push(row);
    childrenOf.set(row.driverAgentId, siblings);
  }
  const seen = new Set<string>();
  function subtree(row: DelegationRecord): DelegationNode {
    seen.add(row.id);
    const kids = (childrenOf.get(row.id) ?? [])
      .filter((r) => !seen.has(r.id))
      .map(subtree);
    return toNode(row, kids);
  }
  const out: DelegationNode[] = [];
  for (const id of ids) {
    const row = byId.get(id);
    if (row && !seen.has(id)) out.push(subtree(row));
  }
  return out;
}
