import { parseQuantity } from "../../../core/quantity.js";

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
 * that neither dimension can hide behind the other.
 *
 * Only memory decides whether an agent fits. An agent's CPU share is a weight
 * on a contended node rather than a reservation, so there is no amount of it
 * that can be used up: a second agent on a busy node makes both slower in
 * proportion to what they asked for, which is the bargain, and it makes no
 * sense to refuse the second one to keep cores idle between somebody's turns.
 * Memory is the opposite — an agent cannot be asked to give it back while it
 * is holding it — so the share of it an agent is promised is subtracted from
 * the node for as long as the agent is placed there, and a node is never
 * promised more than it has.
 *
 * CPU still counts towards fullness, so load spreads across nodes rather than
 * piling onto whichever has the most memory free.
 *
 * An agent whose promised memory is larger than any node is left unplaced
 * rather than crammed onto the emptiest one, because the promise could not be
 * kept there.
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
  return load.memoryBytes + want.memoryBytes <= node.memoryBytes;
}

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

/**
 * UNIT_BOUNDARY_DESCRIPTION: What an agent takes from a node while it is
 * placed there — the share it is promised, which is what its limits are
 * written as. It is not what the agent may use: the ceiling it can burst to is
 * the node's business, not the scheduler's.
 */
export function demandOf(limits: Record<string, string> | undefined): NodeLoad {
  return {
    cpuMilli: Math.round((parseQuantity(limits?.cpu) ?? 0) * 1000),
    memoryBytes: Math.round(parseQuantity(limits?.memory) ?? 0),
  };
}
