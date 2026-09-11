/**
 * UNIT_BOUNDARY_DESCRIPTION: Where an agent runs. Placement is decided at wake
 * rather than at create, because an agent's workspace is on the node's disk and
 * a hibernated agent occupies nothing: choosing late is what makes the choice
 * free, and what turns rebalancing into an ordinary hibernate and wake.
 *
 * The node that last ran the agent is preferred whenever it is ready and the
 * agent still fits, since it is the one that already has the workspace on
 * local disk — anywhere else the agent has to be restored first. Otherwise the
 * emptiest node wins, measured as the larger of its CPU and memory fractions so
 * that neither dimension is filled while the other looks idle.
 *
 * An agent that fits nowhere is left unplaced rather than crammed onto the
 * emptiest node. It is visible as an unplaced agent and an operator adds a
 * node; overcommitting would instead make every agent on that node slower with
 * nothing saying why.
 */
export interface NodeCapacity {
  id: string;
  cpuMilli: number;
  memoryBytes: number;
}

export interface NodeLoad {
  cpuMilli: number;
  memoryBytes: number;
}

export const EMPTY_LOAD: NodeLoad = { cpuMilli: 0, memoryBytes: 0 };

export function fits(
  node: NodeCapacity,
  load: NodeLoad,
  want: NodeLoad,
): boolean {
  return (
    load.cpuMilli + want.cpuMilli <= node.cpuMilli &&
    load.memoryBytes + want.memoryBytes <= node.memoryBytes
  );
}

/** The fuller of the two dimensions, so one cannot hide behind the other. */
function fullness(node: NodeCapacity, load: NodeLoad): number {
  return Math.max(
    node.cpuMilli > 0 ? load.cpuMilli / node.cpuMilli : 1,
    node.memoryBytes > 0 ? load.memoryBytes / node.memoryBytes : 1,
  );
}

export function choosePlacement(input: {
  ready: readonly NodeCapacity[];
  loadOf: (nodeId: string) => NodeLoad;
  want: NodeLoad;
  preferred: string | null;
}): string | null {
  const candidates = input.ready.filter((n) =>
    fits(n, input.loadOf(n.id), input.want),
  );
  if (candidates.length === 0) return null;

  const sticky = candidates.find((n) => n.id === input.preferred);
  if (sticky) return sticky.id;

  return candidates.reduce((best, n) =>
    fullness(n, input.loadOf(n.id)) < fullness(best, input.loadOf(best.id))
      ? n
      : best,
  ).id;
}

/** Kubernetes-style quantities, which is what an agent's limits are written in. */
export function parseQuantity(value: string | undefined): number | null {
  if (!value) return null;
  const match = /^(\d+(?:\.\d+)?)(m|Ki|Mi|Gi|Ti|k|M|G|T)?$/.exec(value.trim());
  if (!match) return null;
  const scale: Record<string, number> = {
    m: 1 / 1000,
    Ki: 1024,
    Mi: 1024 ** 2,
    Gi: 1024 ** 3,
    Ti: 1024 ** 4,
    k: 1000,
    M: 1000 ** 2,
    G: 1000 ** 3,
    T: 1000 ** 4,
  };
  return Number(match[1]) * (match[2] ? scale[match[2]]! : 1);
}

export function demandOf(limits: Record<string, string> | undefined): NodeLoad {
  return {
    cpuMilli: Math.round((parseQuantity(limits?.cpu) ?? 0) * 1000),
    memoryBytes: Math.round(parseQuantity(limits?.memory) ?? 0),
  };
}
